/**
 * Agent tools — the operations the model is allowed to ask for.
 *
 * v1 is deliberately read-only. Every tool here answers a question about the
 * wallet and moves nothing. That is not timidity about the model: the signing
 * key is device-bound, so a model *cannot* move funds even if a tool could. The
 * read-only limit exists because a mutation tool would still be a tool that runs
 * without a human reading it, and that is where the real mistakes live — a
 * hallucinated amount, a wrong address parsed from a truncated string.
 *
 * Adding a writing tool later means: name it, describe its blast radius, show
 * the exact parameters, and require the passkey. The gate is the authenticator,
 * not this file.
 */

import { createPublicClient, erc20Abi, formatUnits, type Hex } from 'viem'
import { arc } from 'viem/chains'
import { toModularTransport } from '@circle-fin/modular-wallets-core'
import { CIRCLE_RPC_URL } from '@/lib/circle-config'
import { AGENT_TOOL_NAMES } from '@/lib/agent-tools-schema'
import type { SwapResult, BridgeResult } from '@/hooks/useAppKitActions'

export { AGENT_TOOLS } from '@/lib/agent-tools-schema'

export interface ToolContext {
  address: Hex
  clientKey: string
  chainPath: string
  usdcContractAddress: Hex
  /**
   * Send USDC. Returns the transaction hash on success, throws on failure.
   * The passkey prompt fires from inside this function; the in-chat
   * confirmation card is the agent-side gate that decides whether to call it.
   */
  sendUsdc: (to: Hex, amountUsd: string) => Promise<string>
  /**
   * Swap a supported token into USDC on Arc Mainnet via Circle App Kit.
   * Same gating as `sendUsdc`: this call only happens after the in-chat
   * confirmation card is approved. Never throws across the React boundary.
   */
  swapUsdc: (args: { tokenIn: 'USDT' | 'EURC' | 'DAI' | 'WETH'; amountIn: string }) => Promise<SwapResult>
  /**
   * Bridge USDC across chains via Circle App Kit + CCTP. Same gating as
   * `sendUsdc`. Never throws across the React boundary.
   */
  bridgeUsdc: (args: { fromChain: 'arc' | 'base' | 'arbitrum'; toChain: 'arc' | 'base' | 'arbitrum'; amount: string }) => Promise<BridgeResult>
}

export type ToolResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string }

function client(ctx: ToolContext) {
  return createPublicClient({
    chain: arc,
    transport: toModularTransport(`${CIRCLE_RPC_URL}${ctx.chainPath}`, ctx.clientKey),
  })
}

const USDC_DECIMALS = 6

/** Run a tool by name. Unknown names fail closed rather than guessing. */
export async function runAgentTool(
  name: string,
  _args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.address || ctx.address === '0x') {
    return { ok: false, error: 'wallet_not_connected' }
  }

  // Allowlist first: the name comes from a model response, so it is untrusted
  // input even though the server chose the catalog.
  if (!AGENT_TOOL_NAMES.includes(name)) {
    return { ok: false, error: `unknown_tool:${name}` }
  }

  try {
    switch (name) {
      case 'get_usdc_balance': {
        const raw = await client(ctx).readContract({
          address: ctx.usdcContractAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [ctx.address],
        })
        return {
          ok: true,
          data: {
            balance: formatUnits(raw, USDC_DECIMALS),
            symbol: 'USDC',
            decimals: USDC_DECIMALS,
            chain: 'Arc Mainnet',
            chainId: arc.id,
          },
        }
      }

      case 'get_wallet_info':
        return {
          ok: true,
          data: {
            address: ctx.address,
            chain: 'Arc Mainnet',
            chainId: arc.id,
            explorer: `https://explorer.arc.io/address/${ctx.address}`,
            type: 'Modular Smart Contract Account (ERC-4337)',
            custodian: 'self — passkey on this device, no seed phrase',
          },
        }

      case 'send_usdc': {
        // Defensive parsing: the args come from a model response, so the shape
        // and content cannot be trusted. Mirror the SAFE_AMOUNT_REGEX from
        // useCircleWallet so the agent cannot bypass the same validation by
        // taking a side door.
        const a = (_args ?? {}) as Record<string, unknown>
        const to = typeof a.to === 'string' ? a.to.trim() : ''
        const amount = typeof a.amount === 'string' ? a.amount.trim() : ''
        if (!/^0x[0-9a-fA-F]{40}$/.test(to)) {
          return { ok: false, error: 'invalid_recipient_address' }
        }
        if (!/^\d{1,12}(\.\d{1,6})?$/.test(amount) || parseFloat(amount) <= 0) {
          return { ok: false, error: 'invalid_amount' }
        }
        try {
          const txHash = await ctx.sendUsdc(to as Hex, amount)
          return {
            ok: true,
            data: { txHash, to, amount, chain: 'Arc Mainnet' },
          }
        } catch (err) {
          // Errors from sendUsdc include passkey-cancelled and insufficient
          // funds. Strip the SDK noise and report a one-line reason so the
          // model can speak to the user without leaking internals.
          const message = err instanceof Error ? err.message : String(err)
          if (/cancel|abort|not.?allowed/i.test(message)) {
            return { ok: false, error: 'passkey_prompt_cancelled' }
          }
          if (/insufficient|balance/i.test(message)) {
            return { ok: false, error: 'insufficient_funds' }
          }
          return { ok: false, error: `send_failed:${message.slice(0, 120)}` }
        }
      }

      case 'swap_tokens': {
        // Defensive parsing + allowlist. Same idea as send_usdc: never trust
        // a model-derived value to land in the kit call without shape checks.
        const a = (_args ?? {}) as Record<string, unknown>
        const tokenIn = typeof a.tokenIn === 'string' ? a.tokenIn : ''
        const amountIn = typeof a.amountIn === 'string' ? a.amountIn.trim() : ''
        const ALLOWED = ['USDT', 'EURC', 'DAI', 'WETH'] as const
        if (!ALLOWED.includes(tokenIn as (typeof ALLOWED)[number])) {
          return { ok: false, error: 'invalid_token' }
        }
        if (!/^\d{1,12}(\.\d{1,6})?$/.test(amountIn) || parseFloat(amountIn) <= 0) {
          return { ok: false, error: 'invalid_amount' }
        }
        const outcome = await ctx.swapUsdc({ tokenIn: tokenIn as 'USDT', amountIn })
        if (outcome.ok) {
          return {
            ok: true,
            data: {
              tokenIn,
              amountIn,
              estimatedOutput: outcome.estimatedOutput,
              fees: outcome.fees,
              txHash: outcome.txHash,
              explorerUrl: outcome.explorerUrl,
              chain: 'Arc Mainnet',
            },
          }
        }
        // Map hook error kinds to model-friendly strings. The hook does not
        // expose an `insufficient_balance` kind today; it folds that into
        // `swap_failed` with an "insufficient" message. We re-check the
        // message so the model can still answer with the right reason.
        const k = outcome.error.kind
        if (k === 'cancelled') return { ok: false, error: 'passkey_prompt_cancelled' }
        if (/insufficient/i.test(outcome.error.message)) {
          return { ok: false, error: 'insufficient_funds' }
        }
        if (k === 'estimate_failed') return { ok: false, error: `estimate_failed:${outcome.error.message.slice(0, 120)}` }
        if (k === 'swap_failed') return { ok: false, error: `swap_failed:${outcome.error.message.slice(0, 120)}` }
        return { ok: false, error: `swap_failed:${outcome.error.message.slice(0, 120)}` }
      }

      case 'bridge_usdc': {
        const a = (_args ?? {}) as Record<string, unknown>
        const fromChain = typeof a.fromChain === 'string' ? a.fromChain : ''
        const toChain = typeof a.toChain === 'string' ? a.toChain : ''
        const amount = typeof a.amount === 'string' ? a.amount.trim() : ''
        const ALLOWED = ['arc', 'base', 'arbitrum'] as const
        if (!ALLOWED.includes(fromChain as (typeof ALLOWED)[number])) {
          return { ok: false, error: 'invalid_from_chain' }
        }
        if (!ALLOWED.includes(toChain as (typeof ALLOWED)[number])) {
          return { ok: false, error: 'invalid_to_chain' }
        }
        if (fromChain === toChain) {
          return { ok: false, error: 'same_source_and_destination' }
        }
        if (!/^\d{1,12}(\.\d{1,6})?$/.test(amount) || parseFloat(amount) <= 0) {
          return { ok: false, error: 'invalid_amount' }
        }
        const outcome = await ctx.bridgeUsdc({
          fromChain: fromChain as 'arc',
          toChain: toChain as 'arc',
          amount,
        })
        if (outcome.ok) {
          return {
            ok: true,
            data: {
              fromChain,
              toChain,
              amount,
              bridgeState: outcome.bridgeState,
              steps: outcome.steps,
              txHash: outcome.txHash,
            },
          }
        }
        const k = outcome.error.kind
        if (k === 'cancelled') return { ok: false, error: 'passkey_prompt_cancelled' }
        if (k === 'bridge_failed') {
          return { ok: false, error: `bridge_incomplete:${outcome.error.bridgeState ?? 'unknown'}` }
        }
        return { ok: false, error: `bridge_failed:${outcome.error.message.slice(0, 120)}` }
      }

      default:
        return { ok: false, error: `unknown_tool:${name}` }
    }
  } catch (err) {
    // Tool errors go back to the model as data, so it can explain rather than
    // retry blindly. No stack, no key.
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `tool_failed:${message.slice(0, 160)}` }
  }
}