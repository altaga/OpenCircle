/**
 * useAppKitActions — headless swap + bridge via Circle App Kit.
 *
 * The two panels (`SwapPanel`, `BridgePanel`) need the actual `kit.swap` and
 * `kit.bridge` calls. The agent needs the same calls, but with no UI in the
 * loop. This hook is the single owner of the AppKit + wagmi wiring; both
 * consumers call into it.
 *
 * Why headless: the panels keep their own estimate/review phase and phase
 * machine, so the hook's contract is "you give me a clean request, I give
 * you a clean result or a classified error". No throwing across React
 * boundaries, no state in the hook — every method is a pure (connector,
 * request) → promise.
 *
 * Security: identical to the panels. No kitKey, no private key, no Circle
 * API key. The wagmi connector is the user's own wallet (here, the
 * Circle passkey MSCA), and the kit prompts for signing through that
 * connector — i.e. the WebAuthn prompt fires from inside the kit's call.
 * The in-chat proposal card in the agent tab is the *first* gate; the
 * WebAuthn prompt is the *second*. Both must pass before funds move.
 */
import { useCallback, useMemo } from 'react'
import { AppKit, SwapChain, BridgeChain, type SwapEstimate } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import { useAccount, useChainId, useSwitchChain } from 'wagmi'
import { arc } from 'viem/chains'
import type { EIP1193Provider } from 'viem'

/** Single AppKit instance, keyless. Same as the panels had inline. */
const kit = new AppKit()

// ── Types ─────────────────────────────────────────────────────────────────────

/** Tokens the user can swap INTO USDC. Matches `SwapPanel` allowlist. */
export const SWAP_TOKENS_IN = ['USDT', 'EURC', 'DAI', 'WETH'] as const
export type SwapTokenIn = (typeof SWAP_TOKENS_IN)[number]

/** Chains the agent can route bridges across. Arc (source or destination) is always one end today. */
export type BridgeChainName = 'arc' | 'base' | 'arbitrum'

export type ActionError =
  | { kind: 'not_connected'; message: string }
  | { kind: 'invalid_input'; message: string; field?: string }
  | { kind: 'cancelled'; message: string }
  | { kind: 'wallet_changed'; message: string }
  | { kind: 'estimate_failed'; message: string }
  | { kind: 'swap_failed'; message: string }
  | { kind: 'bridge_failed'; message: string; bridgeState: string }
  | { kind: 'unknown'; message: string }

export type SwapResult =
  | {
      ok: true
      txHash: string | null
      explorerUrl: string | null
      estimatedOutput: { amount: string; token: string } | null
      fees: Array<{ amount: string; token: string; type: string }>
    }
  | { ok: false; error: ActionError }

export type BridgeResult =
  | {
      ok: true
      bridgeState: string
      steps: Array<{ name: string; state: string; txHash?: string }>
      txHash: string | null
    }
  | { ok: false; error: ActionError }

export interface AppKitActions {
  /** Returns false if the wallet is not connected. */
  readonly isReady: () => boolean
  readonly swapUsdc: (args: { tokenIn: SwapTokenIn; amountIn: string }) => Promise<SwapResult>
  readonly bridgeUsdc: (args: { fromChain: BridgeChainName; toChain: BridgeChainName; amount: string }) => Promise<BridgeResult>
}

// ── Internals ─────────────────────────────────────────────────────────────────

const KIT_BRIDGE: Record<BridgeChainName, BridgeChain> = {
  arc:      BridgeChain.Arc,
  base:     BridgeChain.Base,
  arbitrum: BridgeChain.Arbitrum,
}

const CHAIN_ID: Record<BridgeChainName, number> = {
  arc:      arc.id,
  base:     8453,
  arbitrum: 42161,
}

/** The Arc chain used for swap is always mainnet (the only network we ship). */
const SWAP_CHAIN = SwapChain.Arc
const SWAP_CHAIN_ID = arc.id

/** Display-unit amount: up to 12 integer + up to 6 fractional digits. */
const AMOUNT_RE = /^\d{1,12}(\.\d{1,6})?$/

function asErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function cancelled(err: unknown): boolean {
  const m = asErrorMessage(err)
  return /cancel|abort|not.?allowed|reject/i.test(m)
}

function insufficientFunds(err: unknown): boolean {
  const m = asErrorMessage(err)
  return /insufficient|balance|exceed/i.test(m)
}

function extractTxHash(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null
  const r = result as Record<string, unknown>
  if (typeof r.txHash === 'string') return r.txHash
  if (typeof r.hash === 'string') return r.hash
  return null
}

function extractExplorerUrl(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null
  const r = result as Record<string, unknown>
  if (typeof r.explorerUrl === 'string') return r.explorerUrl
  return null
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAppKitActions(): AppKitActions {
  const { connector, address } = useAccount()
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()

  /** Adapter factory; mirrors the panels' helper. */
  const getAdapter = useCallback(
    async (forChainId: number) => {
      if (!connector) throw new Error('not_connected')
      if (chainId !== forChainId) {
        // Wagmi shows a chain-switch confirmation in the wallet. For an MSCA
        // passkey wallet on a single chain, this is typically a no-op.
        await switchChainAsync({ chainId: forChainId })
      }
      const provider = (await connector.getProvider()) as EIP1193Provider
      return createViemAdapterFromProvider({ provider })
    },
    [connector, chainId, switchChainAsync],
  )

  const isReady = useCallback(() => Boolean(connector && address), [connector, address])

  const swapUsdc = useCallback(
    async (args: { tokenIn: SwapTokenIn; amountIn: string }): Promise<SwapResult> => {
      if (!connector || !address) {
        return { ok: false, error: { kind: 'not_connected', message: 'Wallet is not connected.' } }
      }
      if (!SWAP_TOKENS_IN.includes(args.tokenIn)) {
        return { ok: false, error: { kind: 'invalid_input', message: `Unsupported token: ${args.tokenIn}`, field: 'tokenIn' } }
      }
      if (!AMOUNT_RE.test(args.amountIn) || parseFloat(args.amountIn) <= 0) {
        return { ok: false, error: { kind: 'invalid_input', message: 'Enter a positive numeric amount.', field: 'amountIn' } }
      }
      try {
        const adapter = await getAdapter(SWAP_CHAIN_ID)
        let estimate: SwapEstimate
        try {
          estimate = await kit.estimateSwap({
            from: { adapter, chain: SWAP_CHAIN },
            tokenIn: args.tokenIn,
            tokenOut: 'USDC',
            amountIn: args.amountIn,
            config: { slippageBps: 100 },
          })
        } catch (err) {
          if (cancelled(err)) {
            return { ok: false, error: { kind: 'cancelled', message: 'Estimate cancelled.' } }
          }
          if (insufficientFunds(err)) {
            return { ok: false, error: { kind: 'swap_failed', message: `Not enough ${args.tokenIn} to swap.` } }
          }
          return { ok: false, error: { kind: 'estimate_failed', message: asErrorMessage(err).slice(0, 200) } }
        }
        try {
          const result = await kit.swap({
            from: { adapter, chain: SWAP_CHAIN },
            tokenIn: args.tokenIn,
            tokenOut: 'USDC',
            amountIn: args.amountIn,
            config: { slippageBps: 100 },
          })
          return {
            ok: true,
            txHash: extractTxHash(result),
            explorerUrl: extractExplorerUrl(result),
            // estimatedOutput.amount is also nullable in the kit's typing.
            // Only surface a non-null amount to the agent.
            estimatedOutput:
              estimate.estimatedOutput && estimate.estimatedOutput.amount != null
                ? { amount: estimate.estimatedOutput.amount, token: estimate.estimatedOutput.token }
                : null,
            // The kit's `fee.amount` is typed as `string | null`. We drop
            // nulls so the agent never reports a fee without a value.
            fees: (estimate.fees ?? [])
              .filter((f) => f.amount != null)
              .map((f) => ({ amount: String(f.amount), token: f.token, type: f.type })),
          }
        } catch (err) {
          if (cancelled(err)) {
            return { ok: false, error: { kind: 'cancelled', message: 'Swap cancelled in wallet.' } }
          }
          if (insufficientFunds(err)) {
            return { ok: false, error: { kind: 'swap_failed', message: `Not enough ${args.tokenIn} to swap.` } }
          }
          return { ok: false, error: { kind: 'swap_failed', message: asErrorMessage(err).slice(0, 200) } }
        }
      } catch (err) {
        if (cancelled(err)) {
          return { ok: false, error: { kind: 'cancelled', message: 'Wallet prompt cancelled.' } }
        }
        return { ok: false, error: { kind: 'unknown', message: asErrorMessage(err).slice(0, 200) } }
      }
    },
    [connector, address, getAdapter],
  )

  const bridgeUsdc = useCallback(
    async (args: { fromChain: BridgeChainName; toChain: BridgeChainName; amount: string }): Promise<BridgeResult> => {
      if (!connector || !address) {
        return { ok: false, error: { kind: 'not_connected', message: 'Wallet is not connected.' } }
      }
      if (args.fromChain === args.toChain) {
        return { ok: false, error: { kind: 'invalid_input', message: 'Source and destination must differ.', field: 'fromChain' } }
      }
      if (!AMOUNT_RE.test(args.amount) || parseFloat(args.amount) <= 0) {
        return { ok: false, error: { kind: 'invalid_input', message: 'Enter a positive numeric amount.', field: 'amount' } }
      }
      try {
        const fromAdapter = await getAdapter(CHAIN_ID[args.fromChain])
        const toAdapter   = await getAdapter(CHAIN_ID[args.toChain])
        const result = await kit.bridge({
          from: { adapter: fromAdapter, chain: KIT_BRIDGE[args.fromChain] },
          to:   { adapter: toAdapter,   chain: KIT_BRIDGE[args.toChain] },
          amount: args.amount,
        })
        const steps = (result.steps ?? []).map((s) => ({ name: s.name, state: s.state, txHash: (s as { txHash?: string }).txHash }))
        const txHash = steps.map((s) => s.txHash).find((h): h is string => Boolean(h)) ?? null
        if (result.state === 'success') {
          return { ok: true, bridgeState: result.state, steps, txHash }
        }
        return {
          ok: false,
          error: { kind: 'bridge_failed', message: `Bridge ended with state: ${result.state}.`, bridgeState: result.state },
        }
      } catch (err) {
        if (cancelled(err)) {
          return { ok: false, error: { kind: 'cancelled', message: 'Bridge cancelled in wallet.' } }
        }
        return { ok: false, error: { kind: 'unknown', message: asErrorMessage(err).slice(0, 200) } }
      }
    },
    [connector, address, getAdapter],
  )

  return useMemo<AppKitActions>(
    () => ({ isReady, swapUsdc, bridgeUsdc }),
    [isReady, swapUsdc, bridgeUsdc],
  )
}
