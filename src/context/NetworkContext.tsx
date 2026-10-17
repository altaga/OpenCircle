/**
 * NetworkContext — Arc Mainnet only.
 * USDC address verified onchain: 0x3600000000000000000000000000000000000000
 */
import { createContext, useContext, type ReactNode } from 'react'
import { ARC_MAINNET, CLIENT_KEY } from '@/lib/circle-config'
import { exposeDiagnostics, reportCredentials } from '@/lib/credential-diagnostics'

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
  chainId:             ARC_MAINNET.chainId,
  chainPath:           ARC_MAINNET.chainPath,
  clientKey:           CLIENT_KEY,
  usdcContractAddress: ARC_MAINNET.usdcContractAddress,
}

interface NetworkCtx {
  config:    NetworkConfig
  isMainnet: true
}

const Ctx = createContext<NetworkCtx | null>(null)

export function NetworkProvider({ children }: { children: ReactNode }) {
  // One-shot, offline, no secrets: booleans and enums only.
  reportCredentials(MAINNET_CONFIG)
  exposeDiagnostics(MAINNET_CONFIG)

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
