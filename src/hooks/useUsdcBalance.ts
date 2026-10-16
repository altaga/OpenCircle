/**
 * useUsdcBalance — polls the ERC-20 USDC balance of a Modular Wallet address.
 *
 * Accepts a NetworkConfig so it works on both testnet and mainnet Arc.
 * Uses @/onchain-facts for the USDC contract address (never hardcoded).
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { createPublicClient, erc20Abi } from 'viem'
import { arcTestnet, arc } from 'viem/chains'
import { toModularTransport } from '@circle-fin/modular-wallets-core'
import { getUsdc } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import type { Hex } from 'viem'
import type { NetworkConfig } from '@/context/NetworkContext'

const CLIENT_URL = import.meta.env.VITE_CLIENT_URL as string

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
    const usdcInfo = getUsdc(cfg.chainId)
    if (!addr || addr === '0x' || !usdcInfo) return

    const viemChain = cfg.network === 'mainnet' ? arc : arcTestnet
    const transport = toModularTransport(`${CLIENT_URL}${cfg.chainPath}`, cfg.clientKey)
    const client    = createPublicClient({ chain: viemChain, transport })

    setLoading(true)
    try {
      const balance = await client.readContract({
        address: usdcInfo.address as Hex,
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
