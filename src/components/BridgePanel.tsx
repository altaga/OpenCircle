/**
 * BridgePanel — bridge USDC across chains using Circle App Kit + wagmi adapter.
 *
 * Security:
 *  - No private key, kit key, or Circle API key in browser code.
 *  - User must confirm source, destination, and amount before bridge() is called.
 *  - bridge() is only called from the explicit "Bridge" button handler.
 *  - Soft errors are retried with kit.retryBridge() (prevents double-spend).
 */
import { useState, useRef } from 'react'
import { ArrowRight, AlertCircle, CheckCircle2, Loader2, Info } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { AppKit, BridgeChain } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import { useAccount, useChainId, useSwitchChain } from 'wagmi'
import { arcTestnet, baseSepolia, arbitrumSepolia, arc, base, arbitrum } from 'viem/chains'
import type { EIP1193Provider } from 'viem'
import { useNetwork } from '@/context/NetworkContext'

const kit = new AppKit()

type ChainEntry = { label: string; kitName: BridgeChain; chainId: number }

const TESTNET_CHAINS: ChainEntry[] = [
  { label: 'Arc Testnet',      kitName: BridgeChain.Arc_Testnet,      chainId: arcTestnet.id },
  { label: 'Base Sepolia',     kitName: BridgeChain.Base_Sepolia,     chainId: baseSepolia.id },
  { label: 'Arbitrum Sepolia', kitName: BridgeChain.Arbitrum_Sepolia, chainId: arbitrumSepolia.id },
]

const MAINNET_CHAINS: ChainEntry[] = [
  { label: 'Arc',       kitName: BridgeChain.Arc,      chainId: arc.id },
  { label: 'Base',      kitName: BridgeChain.Base,     chainId: base.id },
  { label: 'Arbitrum',  kitName: BridgeChain.Arbitrum, chainId: arbitrum.id },
]

type BridgePhase = 'idle' | 'bridging' | 'success' | 'error'

interface StepInfo { name: string; state: string; txHash?: string }

const STEP_LABELS: Record<string, string> = {
  approve: 'Approve USDC', burn: 'Burn on source',
  fetchAttestation: 'Waiting for attestation', mint: 'Mint on destination',
}

const glass = {
  card: {
    background: 'rgba(255,255,255,0.72)',
    backdropFilter: 'blur(28px) saturate(180%)',
    WebkitBackdropFilter: 'blur(28px) saturate(180%)',
    border: '1px solid rgba(255,255,255,0.72)',
    boxShadow: '0 8px 40px rgba(18,45,69,0.10), inset 0 1px 0 rgba(255,255,255,0.60)',
  } as React.CSSProperties,
  inner: {
    background: 'rgba(255,255,255,0.46)',
    border: '1px solid rgba(255,255,255,0.56)',
  } as React.CSSProperties,
}

export function BridgePanel() {
  const { connector } = useAccount()
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const { config: netConfig } = useNetwork()

  const CHAINS = netConfig.network === 'mainnet' ? MAINNET_CHAINS : TESTNET_CHAINS

  const [sourceIdx, setSourceIdx] = useState(0)
  const [destIdx, setDestIdx]     = useState(1)
  const [amount, setAmount]       = useState('')
  const [phase, setPhase]         = useState<BridgePhase>('idle')
  const [error, setError]         = useState<string | null>(null)
  const [steps, setSteps]         = useState<StepInfo[]>([])
  const lastResult = useRef<Awaited<ReturnType<typeof kit.bridge>> | null>(null)
  const [hasRetry, setHasRetry]   = useState(false)

  const sourceChain = CHAINS[sourceIdx]
  const destChain   = CHAINS[destIdx]
  const sameChain   = sourceIdx === destIdx

  const getAdapter = async (forChainId: number) => {
    if (!connector) throw new Error('Connect a wallet to bridge')
    if (chainId !== forChainId) await switchChainAsync({ chainId: forChainId })
    const provider = (await connector.getProvider()) as EIP1193Provider
    return createViemAdapterFromProvider({ provider })
  }

  const extractSteps = (result: Awaited<ReturnType<typeof kit.bridge>>): StepInfo[] =>
    (result.steps ?? []).map((s) => ({ name: s.name, state: s.state, txHash: (s as StepInfo).txHash }))

  const handleBridge = async () => {
    if (sameChain) { setError('Source and destination must differ'); return }
    const parsed = parseFloat(amount)
    if (isNaN(parsed) || parsed <= 0) { setError('Enter a valid amount'); return }
    setError(null); setPhase('bridging'); setSteps([]); setHasRetry(false)
    try {
      const fromAdapter = await getAdapter(sourceChain.chainId)
      const toAdapter   = await getAdapter(destChain.chainId)
      const result = await kit.bridge({
        from: { adapter: fromAdapter, chain: sourceChain.kitName },
        to:   { adapter: toAdapter,   chain: destChain.kitName },
        amount,
      })
      lastResult.current = result
      setSteps(extractSteps(result))
      if (result.state === 'success') { setPhase('success'); setHasRetry(false) }
      else { setError(`Bridge ended with state: ${result.state}. You can retry.`); setPhase('error'); setHasRetry(true) }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err)); setPhase('error'); setHasRetry(false)
    }
  }

  const handleRetry = async () => {
    if (!lastResult.current) { setPhase('idle'); return }
    setError(null); setPhase('bridging')
    try {
      const fromAdapter = await getAdapter(sourceChain.chainId)
      const toAdapter   = await getAdapter(destChain.chainId)
      const result = await kit.retryBridge(lastResult.current, { from: fromAdapter, to: toAdapter })
      lastResult.current = result
      setSteps(extractSteps(result))
      if (result.state === 'success') { setPhase('success'); setHasRetry(false) }
      else { setError(`Still not complete: ${result.state}`); setPhase('error'); setHasRetry(true) }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err)); setPhase('error')
    }
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-3xl" style={glass.card}>
        <div className="px-5 pb-5 pt-5 space-y-4">

          {/* From / To chain selectors */}
          <div className="flex items-stretch gap-2">
            <div className="flex-1">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest" style={{ color:'#8a849c' }}>From</p>
              <select
                value={sourceIdx}
                onChange={(e) => setSourceIdx(Number(e.target.value))}
                className="w-full rounded-2xl px-4 py-3.5 text-sm font-medium outline-none"
                style={{ ...glass.inner, color:'#122d45' }}
              >
                {CHAINS.map((c, i) => <option key={c.kitName} value={i}>{c.label}</option>)}
              </select>
            </div>

            {/* Arrow */}
            <div className="flex items-end pb-1">
              <div className="flex h-12 w-10 items-center justify-center rounded-xl" style={{ background:'rgba(18,45,69,0.06)' }}>
                <ArrowRight size={15} style={{ color:'#6b6580' }} />
              </div>
            </div>

            <div className="flex-1">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest" style={{ color:'#8a849c' }}>To</p>
              <select
                value={destIdx}
                onChange={(e) => setDestIdx(Number(e.target.value))}
                className="w-full rounded-2xl px-4 py-3.5 text-sm font-medium outline-none"
                style={{
                  ...glass.inner,
                  color:'#122d45',
                  borderColor: sameChain ? '#ba2b4c' : 'rgba(255,255,255,0.56)',
                }}
              >
                {CHAINS.map((c, i) => <option key={c.kitName} value={i}>{c.label}</option>)}
              </select>
            </div>
          </div>
          {sameChain && (
            <p className="-mt-2 text-xs" style={{ color:'#ba2b4c' }}>Source and destination must differ</p>
          )}

          {/* Amount input */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest" style={{ color:'#8a849c' }}>Amount</p>
            <div className="flex items-baseline gap-2 rounded-2xl px-4 py-3.5" style={glass.inner}>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9.]/g, '')
                  if (v === '' || /^\d{0,12}(\.\d{0,6})?$/.test(v)) setAmount(v)
                }}
                placeholder="0.00"
                className="display min-w-0 flex-1 bg-transparent text-3xl font-bold tabular-nums outline-none placeholder:text-slate-300"
                style={{ color:'#122d45', letterSpacing:'-0.03em' }}
              />
              <span className="shrink-0 text-base font-semibold" style={{ color:'#8a849c' }}>USDC</span>
            </div>
          </div>

          {/* Info */}
          <div className="flex items-center gap-1.5 text-xs" style={{ color:'#8a849c' }}>
            <Info size={11} />
            <span>CCTP v2 fast mode (~8–20s) · fees may apply on some routes</span>
          </div>

          {/* CTA */}
          {!hasRetry ? (
            <button
              disabled={sameChain || !amount || phase === 'bridging'}
              onClick={() => void handleBridge()}
              className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background:'#122d45' }}
            >
              {phase === 'bridging'
                ? <><Loader2 size={16} className="animate-spin" /> Bridging…</>
                : <>Bridge {amount || '0'} USDC</>
              }
            </button>
          ) : (
            <button
              disabled={phase === 'bridging'}
              onClick={() => void handleRetry()}
              className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background:'#122d45' }}
            >
              {phase === 'bridging'
                ? <><Loader2 size={16} className="animate-spin" /> Retrying…</>
                : 'Retry bridge'
              }
            </button>
          )}
        </div>
      </div>

      {/* Step progress */}
      <AnimatePresence>
        {steps.length > 0 && (
          <motion.div
            initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}
            className="overflow-hidden rounded-3xl"
            style={glass.card}
          >
            <div className="px-5 py-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color:'#8a849c' }}>Progress</p>
              {steps.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      background: s.state === 'success' ? '#1a8047' : s.state === 'error' ? '#ba2b4c' : '#8a849c',
                    }}
                  />
                  <span className="flex-1 text-xs font-medium" style={{ color:'#122d45' }}>
                    {STEP_LABELS[s.name] ?? s.name}
                  </span>
                  <span className="text-xs tabular-nums" style={{ color: s.state === 'success' ? '#1a8047' : '#8a849c' }}>
                    {s.state}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Success */}
        {phase === 'success' && (
          <motion.div
            initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}
            className="flex items-start gap-3 rounded-2xl p-4"
            style={{ background:'rgba(26,128,71,0.07)', border:'1px solid rgba(26,128,71,0.18)' }}
          >
            <CheckCircle2 size={18} style={{ color:'#1a8047', flexShrink:0, marginTop:1 }} />
            <p className="text-sm font-semibold" style={{ color:'#1a8047' }}>Bridge complete</p>
          </motion.div>
        )}

        {/* Error */}
        {phase === 'error' && error && (
          <motion.div
            initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}
            className="flex items-start gap-3 rounded-2xl p-4"
            style={{ background:'rgba(186,43,76,0.07)', border:'1px solid rgba(186,43,76,0.18)' }}
          >
            <AlertCircle size={18} style={{ color:'#ba2b4c', flexShrink:0, marginTop:1 }} />
            <p className="text-sm" style={{ color:'#ba2b4c' }}>{error.slice(0, 200)}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
