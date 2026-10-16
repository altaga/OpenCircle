/**
 * BalanceCard — hero USDC balance, glass surface, spectral accent.
 */
import { Copy, Check, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { shortAddress } from '@/hooks/useCircleWallet'
import type { Hex } from 'viem'

interface Props {
  address: Hex
  balance: string
  loading: boolean
  onRefresh: () => void
}

const spectral = 'linear-gradient(90deg,#5fbeff,#af8ff4,#f05c6b,#ffcd83,#7ef1b3)'

export function BalanceCard({ address, balance, loading, onRefresh }: Props) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    void navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className="relative overflow-hidden rounded-3xl"
      style={{
        background: 'rgba(255,255,255,0.72)',
        backdropFilter: 'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border: '1px solid rgba(255,255,255,0.72)',
        boxShadow: '0 8px 40px rgba(18,45,69,0.10), inset 0 1px 0 rgba(255,255,255,0.60)',
      }}
    >
      {/* Spectral top strip */}
      <div className="h-1" style={{ background: spectral }} />

      <div className="px-6 pb-6 pt-5">
        {/* Label row */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div
              className="flex h-5 w-5 items-center justify-center rounded-md"
              style={{ background: 'rgba(26,128,71,0.12)' }}
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="6" r="5" stroke="#1a8047" strokeWidth="1.6" />
                <path d="M4 6h4M6 4v4" stroke="#1a8047" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </div>
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color:'#6b6580' }}>
              USDC Balance
            </span>
          </div>
          <button
            onClick={onRefresh}
            className="rounded-xl p-2 transition-all hover:scale-110 active:scale-95"
            style={{ background:'rgba(18,45,69,0.06)', color:'#6b6580' }}
            title="Refresh"
            aria-label="Refresh balance"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Big balance */}
        <motion.div
          key={balance}
          initial={{ opacity: 0.6, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="flex items-baseline gap-2"
        >
          <span
            className="display font-bold tabular-nums"
            style={{ fontSize: 44, lineHeight: 1, letterSpacing:'-0.04em', color:'#122d45' }}
          >
            {loading && balance === '—' ? (
              <span className="inline-block h-9 w-28 animate-pulse rounded-xl" style={{ background:'rgba(18,45,69,0.08)' }} />
            ) : balance}
          </span>
          <span className="text-xl font-medium" style={{ color:'#8a849c' }}>USDC</span>
        </motion.div>

        <p className="mt-1.5 text-xs" style={{ color:'#8a849c' }}>Arc Testnet</p>

        {/* Address pill */}
        <button
          onClick={copy}
          className="mt-4 flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs transition-all hover:scale-[1.02] active:scale-[0.97]"
          style={{
            background:'rgba(255,255,255,0.46)',
            color:'#6b6580',
            border:'1px solid rgba(255,255,255,0.56)',
          }}
        >
          <span className="mono">{shortAddress(address)}</span>
          {copied
            ? <Check size={12} style={{ color:'#1a8047' }} />
            : <Copy size={12} />}
          <span className="ml-0.5">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
    </div>
  )
}
