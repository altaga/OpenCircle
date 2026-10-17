/**
 * useUsdcBalance — polls the ERC-20 USDC balance of a Modular Wallet address.
 *
 * Accepts a NetworkConfig so it works on both testnet and mainnet Arc.
 * Uses @/onchain-facts for the USDC contract address (never hardcoded).
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { createPublicClient, erc20Abi } from 'viem'
import { arc } from 'viem/chains'
import { toModularTransport } from '@circle-fin/modular-wallets-core'
import type { Hex } from 'viem'
import type { NetworkConfig } from '@/context/NetworkContext'
import { CIRCLE_RPC_URL } from '@/lib/circle-config'

/** Format a USDC raw bigint (6 decimals) to a display string like "12.34" */
function formatUsdc(raw: bigint): string {
  const s = raw.toString().padStart(7, '0')
  const int = s.slice(0, -6) || '0'
  const dec = s.slice(-6).replace(/0+$/, '')
  return dec ? `${int}.${dec}` : int
}

export function useUsdcBalance(address: Hex | null, netConfig: NetworkConfig, pollMs = 15_000) {
  const [raw, setRaw]         = useState<bigint | null>(null)
  const [display, setDisplay] = useState<string>('—')
  const [loading, setLoading] = useState(false)

  // Stable refs so closures always see the latest values
  const addressRef   = useRef(address)
  const netConfigRef = useRef(netConfig)
  useEffect(() => { addressRef.current = address },     [address])
  useEffect(() => { netConfigRef.current = netConfig }, [netConfig])

  const refresh = useCallback(async () => {
    const addr = addressRef.current
    const cfg  = netConfigRef.current
    if (!addr || addr === '0x') return

    const usdcAddress = cfg.usdcContractAddress as Hex
    const transport   = toModularTransport(`${CIRCLE_RPC_URL}${cfg.chainPath}`, cfg.clientKey)
    const client      = createPublicClient({ chain: arc, transport })

    setLoading(true)
    try {
      const balance = await client.readContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [addr],
      })
      setRaw(balance)
      setDisplay(formatUsdc(balance))
    } catch {
      // non-fatal; keep last known value
    } finally {
      setLoading(false)
    }
  }, []) // deps intentionally empty — reads only through refs

  // Reset display when address or network changes (deferred to avoid set-state-in-effect)
  useEffect(() => {
    const t = setTimeout(() => { setRaw(null); setDisplay('—') }, 0)
    return () => clearTimeout(t)
  }, [address, netConfig.network])

  // Initial fetch + poll
  useEffect(() => {
    const t  = setTimeout(() => { void refresh() }, 0)
    const id = setInterval(() => { void refresh() }, pollMs)
    return () => { clearTimeout(t); clearInterval(id) }
  }, [refresh, pollMs, address, netConfig.network])

  return { raw, display, loading, refresh }
}
