/**
 * SwapPanel — swap tokens to USDC using Circle App Kit (browser wallet via wagmi).
 *
 * Security:
 *  - kitKey is NEVER passed — permissionless / keyless mode.
 *  - Estimate is shown before the Swap button is enabled.
 *  - swap() is called only from the explicit button click handler.
 *  - USDC <-> NATIVE on Arc is blocked before routing.
 */
import { useState } from 'react'
import { ArrowDownUp, AlertCircle, CheckCircle2, Loader2, ExternalLink, Info } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { AppKit, SwapChain, type SwapEstimate } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import { useAccount, useChainId, useSwitchChain } from 'wagmi'
import { arcTestnet, arc } from 'viem/chains'
import type { EIP1193Provider } from 'viem'
import { useNetwork } from '@/context/NetworkContext'

const kit = new AppKit() // no kitKey — permissionless

const CHAIN_MAP: Record<string, { kitChain: SwapChain; chainId: number }> = {
  testnet: { kitChain: SwapChain.Arc_Testnet, chainId: arcTestnet.id },
  mainnet: { kitChain: SwapChain.Arc,         chainId: arc.id },
}

const TOKENS_IN  = ['USDT', 'EURC', 'DAI', 'WETH'] as const
const TOKEN_OUT  = 'USDC'

type TokenIn = typeof TOKENS_IN[number]

type SwapPhase = 'idle' | 'estimating' | 'estimated' | 'swapping' | 'success' | 'error'

type ReviewedSwap = {
  estimate: SwapEstimate
  tokenIn: TokenIn
  amountIn: string
  account: string | undefined
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

export function SwapPanel() {
  const { connector, address } = useAccount()
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const { config: netConfig } = useNetwork()

  const CHAIN    = CHAIN_MAP[netConfig.network].kitChain
  const CHAIN_ID = CHAIN_MAP[netConfig.network].chainId

  const [tokenIn, setTokenIn]     = useState<TokenIn>('USDT')
  const [amountIn, setAmountIn]   = useState('')
  const [reviewed, setReviewed]   = useState<ReviewedSwap | null>(null)
  const [phase, setPhase]         = useState<SwapPhase>('idle')
  const [error, setError]         = useState<string | null>(null)
  const [txUrl, setTxUrl]         = useState<string | null>(null)

  const getAdapter = async () => {
    if (!connector) throw new Error('Connect a wallet to swap')
    if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID })
    const provider = (await connector.getProvider()) as EIP1193Provider
    return createViemAdapterFromProvider({ provider })
  }

  const reviewSwap = async () => {
    if (!amountIn || parseFloat(amountIn) <= 0) { setError('Enter a valid amount'); return }
    setError(null)
    setPhase('estimating')
    try {
      const adapter = await getAdapter()
      const est = await kit.estimateSwap({
        from: { adapter, chain: CHAIN },
        tokenIn, tokenOut: TOKEN_OUT, amountIn,
        config: { slippageBps: 100 },
      })
      setReviewed({ estimate: est, tokenIn, amountIn, account: address })
      setPhase('estimated')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }

  const executeSwap = async () => {
    if (!reviewed) return
    if (address !== reviewed.account) { setError('Wallet changed since the estimate; get a new quote.'); setPhase('error'); return }
    setPhase('swapping')
    setError(null)
    try {
      const adapter = await getAdapter()
      const result = await kit.swap({
        from: { adapter, chain: CHAIN },
        tokenIn: reviewed.tokenIn, tokenOut: TOKEN_OUT, amountIn: reviewed.amountIn,
        config: { slippageBps: 100 },
      })
      setTxUrl(result.explorerUrl ?? null)
      setPhase('success')
      setReviewed(null)
      setAmountIn('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }

  const reset = () => { setPhase('idle'); setReviewed(null); setError(null); setTxUrl(null) }
  const isEstimated  = phase === 'estimated'
  const isSwapping   = phase === 'swapping'
  const isEstimating = phase === 'estimating'

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-3xl" style={glass.card}>
        <div className="px-5 pb-5 pt-5 space-y-4">

          {/* You pay row */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest" style={{ color:'#8a849c' }}>You pay</p>
            <div className="flex gap-2">
              {/* Token selector — styled pill */}
              <div
                className="shrink-0 rounded-2xl px-3"
                style={glass.inner}
              >
                <select
                  value={tokenIn}
                  onChange={(e) => { setTokenIn(e.target.value as TokenIn); setReviewed(null); setPhase('idle') }}
                  className="h-full bg-transparent py-3.5 text-sm font-bold outline-none"
                  style={{ color:'#122d45', minWidth: 70 }}
                >
                  {TOKENS_IN.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {/* Amount input */}
              <div className="flex-1 rounded-2xl px-4 py-3" style={glass.inner}>
                <input
                  inputMode="decimal"
                  value={amountIn}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9.]/g, '')
                    if (v === '' || /^\d{0,12}(\.\d{0,6})?$/.test(v)) {
                      setAmountIn(v); setReviewed(null); setPhase('idle')
                    }
                  }}
                  placeholder="0.00"
                  className="display w-full bg-transparent text-3xl font-bold tabular-nums outline-none placeholder:text-slate-300"
                  style={{ color:'#122d45', letterSpacing:'-0.03em' }}
                />
              </div>
            </div>
          </div>

          {/* Swap arrow */}
          <div className="flex justify-center">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background:'rgba(18,45,69,0.07)' }}
            >
              <ArrowDownUp size={15} style={{ color:'#6b6580' }} />
            </div>
          </div>

          {/* You receive row */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest" style={{ color:'#8a849c' }}>You receive</p>
            <div className="flex items-center gap-3 rounded-2xl px-4 py-3.5" style={glass.inner}>
              <span className="text-sm font-bold" style={{ color:'#122d45' }}>USDC</span>
              <span className="ml-auto display text-2xl font-bold tabular-nums" style={{ color: reviewed ? '#1a8047' : '#94a3b8', letterSpacing:'-0.03em' }}>
                {reviewed ? (reviewed.estimate.estimatedOutput?.amount ?? '—') : '—'}
              </span>
            </div>
          </div>

          {/* Fee notice */}
          <div className="flex items-center gap-1.5 text-xs" style={{ color:'#8a849c' }}>
            <Info size={11} />
            <span>Routed via LiFi · 1% max slippage · subject to LiFi ToS</span>
          </div>

          {/* CTA area */}
          <AnimatePresence mode="wait">
            {!isEstimated ? (
              <motion.button
                key="quote"
                initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
                disabled={isEstimating || isSwapping || !amountIn}
                onClick={() => void reviewSwap()}
                className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background:'#122d45' }}
              >
                {isEstimating ? <><Loader2 size={16} className="animate-spin" /> Getting quote…</> : 'Get quote'}
              </motion.button>
            ) : (
              <motion.div
                key="execute"
                initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}
                className="space-y-2"
              >
                {/* Quote summary row */}
                <div className="flex items-center justify-between rounded-2xl px-4 py-3" style={glass.inner}>
                  <span className="text-xs" style={{ color:'#6b6580' }}>
                    {reviewed?.amountIn} {reviewed?.tokenIn} → USDC
                  </span>
                  <span className="text-xs font-semibold" style={{ color:'#1a8047' }}>
                    ≈ {reviewed?.estimate.estimatedOutput?.amount}
                  </span>
                </div>
                {reviewed?.estimate.fees?.map((f, i) => (
                  <p key={i} className="px-1 text-xs" style={{ color:'#8a849c' }}>
                    Fee: {f.amount} {f.token} ({f.type})
                  </p>
                ))}
                <button
                  disabled={isSwapping}
                  onClick={() => void executeSwap()}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background:'#122d45' }}
                >
                  {isSwapping
                    ? <><Loader2 size={16} className="animate-spin" /> Swapping…</>
                    : `Swap ${reviewed?.amountIn} ${reviewed?.tokenIn} → USDC`
                  }
                </button>
                <button onClick={reset} className="w-full py-2 text-xs font-medium" style={{ color:'#8a849c' }}>
                  Cancel
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Status banners */}
      <AnimatePresence>
        {phase === 'success' && (
          <motion.div
            initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}
            className="flex items-start gap-3 rounded-2xl p-4"
            style={{ background:'rgba(26,128,71,0.07)', border:'1px solid rgba(26,128,71,0.18)' }}
          >
            <CheckCircle2 size={18} style={{ color:'#1a8047', flexShrink:0, marginTop:1 }} />
            <div>
              <p className="text-sm font-semibold" style={{ color:'#1a8047' }}>Swap complete</p>
              {txUrl && (
                <a href={txUrl} target="_blank" rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs hover:underline underline-offset-2"
                  style={{ color:'#6b6580' }}>
                  View on explorer <ExternalLink size={11} />
                </a>
              )}
            </div>
          </motion.div>
        )}
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
