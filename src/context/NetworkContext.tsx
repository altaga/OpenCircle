/**
 * NetworkContext — global testnet / mainnet toggle.
 *
 * WARNING: Mainnet involves real funds. The toggle shows a confirmation modal
 * before activating mainnet. Passkeys created on testnet do NOT work on mainnet
 * (and vice versa) — different circle-client-key scopes.
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { arcTestnet } from 'viem/chains'
import { getChain } from '@/onchain-facts'

export type Network = 'testnet' | 'mainnet'

// Arc mainnet chain ID from onchain-facts
const ARC_MAINNET_ID  = 5042
const ARC_TESTNET_ID  = arcTestnet.id

export interface NetworkConfig {
  network:    Network
  chainId:    number
  chainPath:  string   // toModularTransport path segment
  clientKey:  string   // VITE_CLIENT_KEY (testnet) | VITE_CLIENT_KEY_MAINNET
  usdcContractAddress: string
}

function buildConfig(network: Network): NetworkConfig {
  if (network === 'mainnet') {
    const chain = getChain(ARC_MAINNET_ID)
    return {
      network: 'mainnet',
      chainId: ARC_MAINNET_ID,
      chainPath: '/arc',
      clientKey: (import.meta.env.VITE_CLIENT_KEY_MAINNET as string) ?? '',
      usdcContractAddress: chain?.usdc?.address ?? '0x3600000000000000000000000000000000000000',
    }
  }
  const chain = getChain(ARC_TESTNET_ID)
  return {
    network: 'testnet',
    chainId: ARC_TESTNET_ID,
    chainPath: '/arcTestnet',
    clientKey: (import.meta.env.VITE_CLIENT_KEY as string) ?? '',
    usdcContractAddress: chain?.usdc?.address ?? '0x3600000000000000000000000000000000000000',
  }
}

interface NetworkCtx {
  config:       NetworkConfig
  setNetwork:   (n: Network) => void
  isMainnet:    boolean
}

const Ctx = createContext<NetworkCtx | null>(null)

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<NetworkConfig>(() => buildConfig('testnet'))

  const setNetwork = useCallback((n: Network) => {
    setConfig(buildConfig(n))
  }, [])

  return (
    <Ctx.Provider value={{ config, setNetwork, isMainnet: config.network === 'mainnet' }}>
      {children}
    </Ctx.Provider>
  )
}

export function useNetwork(): NetworkCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useNetwork must be used inside <NetworkProvider>')
  return ctx
}
