/**
 * Circle config — Arc Mainnet only.
 *
 * Every value here is a constant. The ONE thing that comes from the
 * environment is the client key, because it is a credential: everything else
 * is part of the app's identity and has no reason to be configurable per
 * deploy.
 *
 * Client key: Circle Console → Keys → Client Keys → production key.
 * A client key is safe in a browser bundle; that is what it is for.
 */
export const CIRCLE_RPC_URL = 'https://modular-sdk.circle.com/v1/rpc/w3s/buidl'

export const ARC_MAINNET = {
  chainId:             5042,
  chainPath:           '/arc',
  usdcContractAddress: '0x3600000000000000000000000000000000000000',
  explorer:            'https://explorer.arc.io',
} as const

/** The only environment variable this app needs. */
export const CLIENT_KEY = (import.meta.env.VITE_CLIENT_KEY_MAINNET as string) ?? ''
