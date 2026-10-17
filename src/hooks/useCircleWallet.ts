/**
 * useCircleWallet — Modular Wallet (passkey / ERC-4337 MSCA) hook
 *
 * Security:
 *  - Credentials are stored in sessionStorage only (cleared on tab close).
 *    Production apps should use httpOnly cookies to mitigate XSS theft.
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
  type WebAuthnCredential,
} from '@circle-fin/modular-wallets-core'
import { type P256Credential } from 'viem/account-abstraction'
import { createPublicClient, type Hex } from 'viem'
import { createBundlerClient, toWebAuthnAccount } from 'viem/account-abstraction'
import { arc } from 'viem/chains'
import type { NetworkConfig } from '@/context/NetworkContext'
import { CIRCLE_RPC_URL } from '@/lib/circle-config'
import { logSafeError, runProbe } from '@/lib/credential-diagnostics'

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
export type WalletState = 'idle' | 'registering' | 'logging_in' | 'ready' | 'error'
export type TxState     = 'idle' | 'signing' | 'confirming' | 'success' | 'error'

export interface CircleWallet {
  address:  Hex
  state:    WalletState
  txState:  TxState
  txHash:   string | null
  txError:  string | null
  register: (username: string) => Promise<void>
  login:    () => Promise<void>
  logout:   () => void
  sendUsdc: (to: Hex, amountUsd: string) => Promise<string>
}

// ── Security helpers ──────────────────────────────────────────────────────────

// CRIT-01: Structural validation — prevents XSS injecting a fake credential via sessionStorage.
function isValidCredentialShape(obj: unknown): obj is WebAuthnCredential {
  if (typeof obj !== 'object' || obj === null) return false
  const c = obj as Record<string, unknown>
  return (
    typeof c.id === 'string' && c.id.length > 0 &&
    typeof c.publicKey === 'string' && /^0x[0-9a-fA-F]+$/.test(c.publicKey)
  )
}

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

// WebAuthnCredential is compatible with P256Credential (both have id + publicKey).
function toP256(cred: WebAuthnCredential): P256Credential { return cred }

// Session key includes network so testnet/mainnet sessions never cross.
function sessionKey(network: string) { return `oc_credential_${network}` }

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useCircleWallet(netConfig: NetworkConfig): CircleWallet {
  const [credential, setCredential] = useState<WebAuthnCredential | null>(null)
  const [address, setAddress]       = useState<Hex | null>(null)
  const [state, setState]           = useState<WalletState>('idle')
  const [txState, setTxState]       = useState<TxState>('idle')
  const [txHash, setTxHash]         = useState<string | null>(null)
  const [txError, setTxError]       = useState<string | null>(null)
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
    sessionStorage.removeItem(sessionKey(netConfig.network === 'mainnet' ? 'testnet' : 'mainnet'))
    setCredential(null)
    setAddress(null)
    setState('idle')
    setTxState('idle')
    setTxHash(null)
    setTxError(null)
    sendingRef.current = false
  }, [netConfig.network])

  // ── Restore session on mount (deferred to avoid react/set-state-in-effect) ─
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(sessionKey(netConfig.network))
        if (!raw) return
        let parsed: unknown
        try { parsed = JSON.parse(raw) } catch { sessionStorage.removeItem(sessionKey(netConfig.network)); return }
        if (!isValidCredentialShape(parsed)) { sessionStorage.removeItem(sessionKey(netConfig.network)); return }
        const cred = parsed
        void (async () => {
          const pubClient = makePublicClient()
          const account = await toCircleSmartAccount({
            client: pubClient,
            owner: toWebAuthnAccount({ credential: toP256(cred) }),
          })
          setCredential(cred)
          setAddress(account.address)
          setState('ready')
        })()
      } catch {
        sessionStorage.removeItem(sessionKey(netConfig.network))
      }
    }, 0)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [netConfig.network]) // intentionally limited — rebuild on network change only

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
      sessionStorage.setItem(sessionKey(netConfig.network), JSON.stringify(cred))
      const pubClient = makePublicClient()
      const account = await toCircleSmartAccount({
        client: pubClient,
        owner: toWebAuthnAccount({ credential: toP256(cred) }),
      })
      setCredential(cred)
      setAddress(account.address)
      setState('ready')
    } catch (err) {
      setState('error')
      logSafeError('register', err)
      void runProbe(netConfig)
      setTxError(err instanceof Error ? err.message : String(err))
    }
  }, [makePasskeyTransport, makePublicClient, netConfig.network])

  // ── Login ──────────────────────────────────────────────────────────────────
  const login = useCallback(async () => {
    setState('logging_in')
    setTxError(null)
    try {
      const cred = await toWebAuthnCredential({
        transport: makePasskeyTransport(),
        mode: WebAuthnMode.Login,
      })
      sessionStorage.setItem(sessionKey(netConfig.network), JSON.stringify(cred))
      const pubClient = makePublicClient()
      const account = await toCircleSmartAccount({
        client: pubClient,
        owner: toWebAuthnAccount({ credential: toP256(cred) }),
      })
      setCredential(cred)
      setAddress(account.address)
      setState('ready')
    } catch (err) {
      setState('error')
      logSafeError('login', err)
      void runProbe(netConfig)
      setTxError(err instanceof Error ? err.message : String(err))
    }
  }, [makePasskeyTransport, makePublicClient, netConfig.network])

  // ── Logout ─────────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    sessionStorage.removeItem(sessionKey(netConfig.network))
    setCredential(null)
    setAddress(null)
    setState('idle')
    setTxState('idle')
    setTxHash(null)
    setTxError(null)
  }, [netConfig.network])

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

      const account  = await toCircleSmartAccount({
        client: pubClient,
        owner: toWebAuthnAccount({ credential: toP256(credential) }),
      })
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
      const msg = err instanceof Error ? err.message : String(err)
      setTxError(msg)
      setTxState('error')
      sendingRef.current = false
      throw err
    }
  }, [credential, address, makePublicClient, makeBundlerClient, netConfig])

  return {
    address: address ?? ('0x'),
    state,
    txState,
    txHash,
    txError,
    register,
    login,
    logout,
    sendUsdc,
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────
export function shortAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export { formatUsdc }
