/**
 * NetworkContext — Arc Mainnet only.
 * USDC address verified onchain: 0x3600000000000000000000000000000000000000
 */
import { createContext, useContext, type ReactNode } from 'react'

export type Network = 'mainnet'

export interface NetworkConfig {
  network:             Network
  chainId:             number
  chainPath:           string
  clientKey:           string
  usdcContractAddress: string
}

const MAINNET_CONFIG: NetworkConfig = {
  network:             'mainnet',
  chainId:             5042,
  chainPath:           '/arc',
  clientKey:           (import.meta.env.VITE_CLIENT_KEY_MAINNET as string) ?? '',
  usdcContractAddress: '0x3600000000000000000000000000000000000000',
}

interface NetworkCtx {
  config:    NetworkConfig
  isMainnet: true
}

const Ctx = createContext<NetworkCtx | null>(null)

export function NetworkProvider({ children }: { children: ReactNode }) {
  return (
    <Ctx.Provider value={{ config: MAINNET_CONFIG, isMainnet: true }}>
      {children}
    </Ctx.Provider>
  )
}

export function useNetwork(): NetworkCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useNetwork must be used inside <NetworkProvider>')
  return ctx
}
