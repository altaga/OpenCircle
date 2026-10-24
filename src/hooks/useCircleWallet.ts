/**
 * useCircleWallet — Modular Wallet (passkey / ERC-4337 MSCA) hook
 *
 * Security:
 *  - Credentials are stored in IndexedDB (primary) with a localStorage mirror,
 *    so the wallet survives a browser restart. Only the credential's *public*
 *    half is persisted — the signing key never leaves the authenticator.
 *  - No private key is ever generated or stored on the client.
 *  - All transactions are user-operations sponsored by Circle Gas Station.
 *  - Transports are created per-call — network config is read from context, not
 *    captured in module-level closures, so switching networks takes effect immediately.
 *
 * MAINNET WARNING: Transactions on mainnet are irreversible and involve real funds.
 * Confirm every send with the user before executing.
 */
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  WebAuthnMode,
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
  encodeTransfer,
} from '@circle-fin/modular-wallets-core'
import { type P256Credential } from 'viem/account-abstraction'
import { createPublicClient, type Hex, http } from 'viem'
import { createBundlerClient, toWebAuthnAccount } from 'viem/account-abstraction'
import { arc } from 'viem/chains'
import type { NetworkConfig } from '@/context/NetworkContext'
import { CIRCLE_RPC_URL } from '@/lib/circle-config'
import { friendlyWalletError } from '@/lib/wallet-errors'
import {
  forgetCredential,
  readCredential,
  readRemember,
  setRemember as setRememberPref,
  writeCredential,
  type StoredCredential,
} from '@/lib/credential-store'
import { reauthWithPasskey } from '@/lib/wallet-reauth'

/** Parse a USDC display string (e.g. "12.50") to raw bigint (6 decimals). */
function parseUsdc(amount: string): bigint {
  const [int = '0', dec = ''] = amount.split('.')
  const padded = dec.slice(0, 6).padEnd(6, '0')
  return BigInt(int) * 1_000_000n + BigInt(padded)
}

/** Format raw USDC bigint to display string. */
function formatUsdc(raw: bigint): string {
  const s = raw.toString().padStart(7, '0')
  const int = s.slice(0, -6) || '0'
  const dec = s.slice(-6).replace(/0+$/, '')
  return dec ? `${int}.${dec}` : int
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type WalletState = 'restoring' | 'idle' | 'registering' | 'logging_in' | 'ready' | 'error'
export type TxState     = 'idle' | 'signing' | 'confirming' | 'success' | 'error'

/**
 * How long the splash stays up once a wallet has actually been restored.
 *
 * Restore itself is fast; the hold is there so arriving at the dashboard feels
 * deliberate instead of a snap. It is *not* applied when no credential is
 * found — a first-time visitor goes straight to the sign-in card.
 */
export const SPLASH_MIN_MS = 200

function holdFor(startedAt: number, ms: number): Promise<void> {
  const remaining = ms - (Date.now() - startedAt)
  if (remaining <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, remaining))
}

export interface CircleWallet {
  address:  Hex
  state:    WalletState
  txState:  TxState
  txHash:   string | null
  txError:  string | null
  register: (username: string) => Promise<void>
  login:    () => Promise<void>
  logout:   () => Promise<boolean>
  remember: boolean
  setRemember: (on: boolean) => void
  sendUsdc: (to: Hex, amountUsd: string) => Promise<string>
}

// ── Security helpers ──────────────────────────────────────────────────────────

// CRIT-01: structural validation of the stored credential lives in
// credential-store, so every read path (restore, register, login) is guarded.

// CRIT-02: Strict amount validation — blocks scientific notation, overflow, negatives.
const SAFE_AMOUNT_REGEX = /^\d{1,12}(\.\d{1,6})?$/

function validateSafeAmount(amountUsd: string): string {
  const trimmed = amountUsd.trim()
  if (!SAFE_AMOUNT_REGEX.test(trimmed))
    throw new Error('Invalid amount: use plain decimal notation with up to 6 decimal places')
  const val = parseFloat(trimmed)
  if (isNaN(val) || val <= 0) throw new Error('Amount must be greater than zero')
  return trimmed
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// A credential is compatible with P256Credential for the two fields viem
// actually reads: `id` and `publicKey`.
function toP256(cred: { id: string; publicKey: string }): P256Credential {
  return cred as unknown as P256Credential
}

async function deriveOfflineSmartAccount(
  viemChain: typeof arc,
  cred: StoredCredential,
  address?: Hex,
) {
  const offlineClient = createPublicClient({ chain: viemChain, transport: http() })
  return toCircleSmartAccount({
    client: offlineClient,
    owner: toWebAuthnAccount({ credential: toP256(cred) }),
    ...(address ? { address } : {}),
  })
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useCircleWallet(netConfig: NetworkConfig): CircleWallet {
  const [credential, setCredential] = useState<StoredCredential | null>(null)
  const [address, setAddress]       = useState<Hex | null>(null)
  const [state, setState]           = useState<WalletState>('restoring')
  const [txState, setTxState]       = useState<TxState>('idle')
  const [txHash, setTxHash]         = useState<string | null>(null)
  const [txError, setTxError]       = useState<string | null>(null)
  const [remember, setRememberState] = useState(true)
  const sendingRef                  = useRef(false)

  const CLIENT_URL = CIRCLE_RPC_URL

  // Arc Mainnet only.
  const viemChain = useMemo(() => arc, [])

  // ── Transport factories (fresh per call, not module-level) ─────────────────
  const makePasskeyTransport = useCallback(
    () => toPasskeyTransport(CLIENT_URL, netConfig.clientKey),
    [CLIENT_URL, netConfig.clientKey],
  )

  const makeModularTransport = useCallback(
    () => toModularTransport(`${CLIENT_URL}${netConfig.chainPath}`, netConfig.clientKey),
    [CLIENT_URL, netConfig.chainPath, netConfig.clientKey],
  )

  const makePublicClient = useCallback(
    () => createPublicClient({ chain: viemChain, transport: makeModularTransport() }),
    [viemChain, makeModularTransport],
  )

  const makeBundlerClient = useCallback(
    () => createBundlerClient({ chain: viemChain, transport: makeModularTransport() }),
    [viemChain, makeModularTransport],
  )

  // ── Reset wallet state when network changes ───────────────────────────────
  const prevNetworkRef = useRef(netConfig.network)
  useEffect(() => {
    if (prevNetworkRef.current === netConfig.network) return
    prevNetworkRef.current = netConfig.network
    // Fire-and-forget: the effect cannot await, and a failed localStorage
    // wipe is not a state the wallet can meaningfully recover to. The state
    // reset below is what actually signs the user out.
    void forgetCredential(netConfig.network === 'mainnet' ? 'testnet' : 'mainnet')
    setCredential(null)
    setAddress(null)
    setState('idle')
    setTxState('idle')
    setTxHash(null)
    setTxError(null)
    sendingRef.current = false
  }, [netConfig.network])

  // ── Restore on boot (deferred to avoid react/set-state-in-effect) ─────────
  // Starts in the `restoring` state so the UI holds a splash instead of
  // painting the sign-in card and snapping to the dashboard a moment later.
  // Reads IndexedDB, so a wallet remembered on this device opens without a
  // passkey prompt. Opening is prompt-free; spending never is.
  useEffect(() => {
    let cancelled = false
    const startedAt = Date.now()
    const t = setTimeout(() => {
      void (async () => {
        const cred = await readCredential(netConfig.network)
        const remembered = await readRemember(netConfig.network)
        if (cancelled) return
        setRememberState(remembered)

        if (!cred) {
          setState('idle')
          return
        }

        // 1. Resolve address: from cached credential or via deterministic offline CREATE2 derivation
        let resolvedAddress: Hex | null = cred.address ?? null
        if (!resolvedAddress) {
          try {
            const offlineAccount = await deriveOfflineSmartAccount(viemChain, cred)
            resolvedAddress = offlineAccount.address
          } catch (derivErr) {
            console.warn('[useCircleWallet] offline address derivation notice:', derivErr)
          }
        }

        // 2. If address is resolved, immediately promote wallet to ready state
        if (resolvedAddress) {
          const fullCred: StoredCredential = { ...cred, address: resolvedAddress }
          if (!cancelled) {
            setCredential(fullCred)
            setAddress(resolvedAddress)
            setState('ready')
          }
          if (cred.address !== resolvedAddress) {
            void writeCredential(netConfig.network, fullCred, remembered, resolvedAddress)
          }
        }

        // 3. Optional: sync with Circle modular transport if client key and RPC are available
        try {
          const account = await toCircleSmartAccount({
            client: makePublicClient(),
            owner: toWebAuthnAccount({ credential: toP256(cred) }),
            ...(resolvedAddress ? { address: resolvedAddress } : {}),
          })
          await holdFor(startedAt, SPLASH_MIN_MS)
          if (cancelled) return
          const fullCred: StoredCredential = { ...cred, address: account.address }
          setCredential(fullCred)
          setAddress(account.address)
          setState('ready')
          if (cred.address !== account.address) {
            void writeCredential(netConfig.network, fullCred, remembered, account.address)
          }
        } catch (err) {
          console.warn('[useCircleWallet] online modular transport notice on restore:', err)
          // If we couldn't resolve the address either offline or online, only then show error
          if (!resolvedAddress && !cancelled) {
            setTxError(friendlyWalletError(err))
            setState('error')
          }
        }
      })()
    }, 0)
    return () => { cancelled = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [netConfig.network]) // intentionally limited — rebuild on network change only

  // ── "Remember me on this device" ───────────────────────────────────────────
  const setRemember = useCallback((on: boolean) => {
    setRememberState(on)
    void setRememberPref(netConfig.network, on)
  }, [netConfig.network])

  // ── Register ───────────────────────────────────────────────────────────────
  const register = useCallback(async (username: string) => {
    setState('registering')
    setTxError(null)
    try {
      const cred = await toWebAuthnCredential({
        transport: makePasskeyTransport(),
        mode: WebAuthnMode.Register,
        username,
      })
      let accountAddress: Hex | null = null
      try {
        const pubClient = makePublicClient()
        const account = await toCircleSmartAccount({
          client: pubClient,
          owner: toWebAuthnAccount({ credential: toP256(cred) }),
        })
        accountAddress = account.address
      } catch (err) {
        console.warn('[register] modular transport derivation notice, falling back to offline derivation:', err)
        const offlineAccount = await deriveOfflineSmartAccount(viemChain, cred)
        accountAddress = offlineAccount.address
      }
      const fullCred: StoredCredential = { ...cred, address: accountAddress }
      await writeCredential(netConfig.network, fullCred, remember, accountAddress)
      setCredential(fullCred)
      setAddress(accountAddress)
      setState('ready')
    } catch (err) {
      setState('error')
      setTxError(friendlyWalletError(err, { username }))
    }
  }, [makePasskeyTransport, makePublicClient, netConfig.network, remember, viemChain])

  // ── Login ──────────────────────────────────────────────────────────────────
  const login = useCallback(async () => {
    setState('logging_in')
    setTxError(null)
    try {
      const cred = await toWebAuthnCredential({
        transport: makePasskeyTransport(),
        mode: WebAuthnMode.Login,
      })
      let accountAddress: Hex | null = null
      try {
        const pubClient = makePublicClient()
        const account = await toCircleSmartAccount({
          client: pubClient,
          owner: toWebAuthnAccount({ credential: toP256(cred) }),
        })
        accountAddress = account.address
      } catch (err) {
        console.warn('[login] modular transport derivation notice, falling back to offline derivation:', err)
        const offlineAccount = await deriveOfflineSmartAccount(viemChain, cred)
        accountAddress = offlineAccount.address
      }
      const fullCred: StoredCredential = { ...cred, address: accountAddress }
      await writeCredential(netConfig.network, fullCred, remember, accountAddress)
      setCredential(fullCred)
      setAddress(accountAddress)
      setState('ready')
    } catch (err) {
      setState('error')
      setTxError(friendlyWalletError(err))
    }
  }, [makePasskeyTransport, makePublicClient, netConfig.network, remember, viemChain])

  // ── Logout ─────────────────────────────────────────────────────────────────
  // Re-authenticates with the same passkey that registered the wallet before
  // wiping. A failure here is the explicit "user did not confirm" signal —
  // the credential stays, the UI shows the error, the user is still signed
  // in. Returns true if the wipe went through, false if it was blocked.
  const logout = useCallback(async (): Promise<boolean> => {
    if (!credential) return true
    const ok = await reauthWithPasskey(credential)
    if (!ok) {
      setTxError('Could not verify your passkey. Sign out cancelled.')
      return false
    }
    await forgetCredential(netConfig.network)
    setRememberState(false)
    setCredential(null)
    setAddress(null)
    setState('idle')
    setTxState('idle')
    setTxHash(null)
    setTxError(null)
    return true
  }, [credential, netConfig.network])

  // ── Send USDC ──────────────────────────────────────────────────────────────
  const sendUsdc = useCallback(async (to: Hex, amountUsd: string): Promise<string> => {
    if (!credential || !address) throw new Error('Wallet not connected')

    const safeAmount = validateSafeAmount(amountUsd)

    if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error('Invalid recipient address')
    if (to.toLowerCase() === ZERO_ADDRESS) throw new Error('Sending to zero address is not allowed')

    if (sendingRef.current) throw new Error('A transaction is already in progress')
    sendingRef.current = true

    setTxState('signing')
    setTxHash(null)
    setTxError(null)
    try {
      const pubClient     = makePublicClient()
      const bundler       = makeBundlerClient()
      const usdcAddress = netConfig.usdcContractAddress as Hex
      if (!usdcAddress || usdcAddress === '0x') throw new Error('No USDC contract known for this chain')

      let account
      try {
        account = await toCircleSmartAccount({
          client: pubClient,
          owner: toWebAuthnAccount({ credential: toP256(credential) }),
          address,
        })
      } catch {
        account = await deriveOfflineSmartAccount(viemChain, credential, address)
      }
      const amount   = parseUsdc(safeAmount)
      const callData = encodeTransfer(to, usdcAddress, amount)

      setTxState('confirming')
      // Gas is paid by the user in USDC (Arc native token).
      // Set paymaster: true here to sponsor gas via Circle Gas Station instead.
      const userOpHash = await bundler.sendUserOperation({
        account,
        calls: [callData],
      })
      const { receipt } = await bundler.waitForUserOperationReceipt({ hash: userOpHash })
      const hash = receipt.transactionHash
      setTxHash(hash)
      setTxState('success')
      sendingRef.current = false
      return hash
    } catch (err) {
      const msg = friendlyWalletError(err)
      setTxError(msg)
      setTxState('error')
      sendingRef.current = false
      throw new Error(msg)
    }
  }, [credential, address, makePublicClient, makeBundlerClient, netConfig, viemChain])

  return {
    address: address ?? ('0x'),
    state,
    txState,
    txHash,
    txError,
    register,
    login,
    logout,
    remember,
    setRemember,
    sendUsdc,
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────
export function shortAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export { formatUsdc }
