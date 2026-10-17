/**
 * SendPanel — send USDC with a large amount input + glass card.
 * Security: validates address + amount before any signing.
 */
import { useState } from 'react'
import { Send, AlertCircle, CheckCircle2, Loader2, ExternalLink } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Hex } from 'viem'
import type { TxState } from '@/hooks/useCircleWallet'

interface Props {
  balance: string
  rawBalance: bigint | null
  txState: TxState
  txHash: string | null
  txError: string | null
  onSend: (to: Hex, amount: string) => void
}

/** Arc Mainnet block explorer */
function buildTxExplorerUrl(txHash: string): string {
  const hash = /^0x[0-9a-fA-F]{64}$/.test(txHash) ? txHash : ''
  if (!hash) return '#'
  return `https://explorer.arc.io/tx/${hash}`
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

export function SendPanel({ balance, rawBalance: _rawBalance, txState, txHash, txError, onSend }: Props) {
  const [to, setTo]     = useState('')
  const [amount, setAmount] = useState('')

  const addressValid = /^0x[0-9a-fA-F]{40}$/.test(to)
  const amountNum    = parseFloat(amount)
  const amountValid  = !isNaN(amountNum) && amountNum > 0
  const canSend      = addressValid && amountValid && txState === 'idle'

  const explorerUrl  = txHash ? buildTxExplorerUrl(txHash) : null

  const handleSend = () => { if (canSend) onSend(to as Hex, amount) }

  const isBusy = txState === 'signing' || txState === 'confirming'

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-3xl" style={glass.card}>
        <div className="px-5 pb-5 pt-5">

          {/* Amount input — big + centered */}
          <div className="mb-4 rounded-2xl p-4" style={glass.inner}>
            <div className="flex items-baseline gap-2">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9.]/g, '')
                  if (v === '' || /^\d{0,12}(\.\d{0,6})?$/.test(v)) setAmount(v)
                }}
                placeholder="0.00"
                className="display min-w-0 flex-1 bg-transparent text-4xl font-bold tabular-nums outline-none placeholder:text-slate-300"
                style={{ color:'#122d45', letterSpacing:'-0.04em' }}
              />
              <span className="shrink-0 text-lg font-semibold" style={{ color:'#8a849c' }}>USDC</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs" style={{ color:'#8a849c' }}>Amount to send</span>
              <button
                className="text-xs font-semibold"
                style={{ color:'#1061a6' }}
                onClick={() => {
                  // strip display formatting to raw numeric
                  const raw = balance.replace(/[^0-9.]/g, '')
                  if (raw) setAmount(raw)
                }}
              >
                Balance: {balance} · Max
              </button>
            </div>
          </div>

          {/* Recipient address */}
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest" style={{ color:'#8a849c' }}>
              To
            </label>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value.trim())}
              placeholder="0x…"
              spellCheck={false}
              className="mono w-full rounded-2xl px-4 py-3 text-sm outline-none transition-all"
              style={{
                background:'rgba(255,255,255,0.46)',
                color:'#122d45',
                border: `1px solid ${to && !addressValid ? '#ba2b4c' : 'rgba(255,255,255,0.56)'}`,
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#85b1ed'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(133,177,237,0.18)' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = to && !addressValid ? '#ba2b4c' : 'rgba(255,255,255,0.56)'; e.currentTarget.style.boxShadow = 'none' }}
            />
            <AnimatePresence>
              {to && !addressValid && (
                <motion.p
                  initial={{ opacity:0, y:-4 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}
                  className="mt-1 text-xs" style={{ color:'#ba2b4c' }}
                >
                  Must be a valid 0x Ethereum address
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          {/* CTA */}
          <button
            disabled={!canSend}
            onClick={handleSend}
            className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background:'#122d45' }}
          >
            {txState === 'signing' ? (
              <><Loader2 size={16} className="animate-spin" /> Confirm in passkey…</>
            ) : txState === 'confirming' ? (
              <><Loader2 size={16} className="animate-spin" /> Confirming on-chain…</>
            ) : (
              <><Send size={15} /> Send {amount ? `${amount} USDC` : 'USDC'}</>
            )}
          </button>
          {isBusy && (
            <p className="mt-2 text-center text-xs" style={{ color:'#8a849c' }}>
              Gas is paid from your USDC balance
            </p>
          )}
        </div>
      </div>

      {/* Success */}
      <AnimatePresence>
        {txState === 'success' && txHash && (
          <motion.div
            initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}
            className="flex items-start gap-3 rounded-2xl p-4"
            style={{ background:'rgba(26,128,71,0.07)', border:'1px solid rgba(26,128,71,0.18)' }}
          >
            <CheckCircle2 size={18} style={{ color:'#1a8047', flexShrink:0, marginTop:1 }} />
            <div>
              <p className="text-sm font-semibold" style={{ color:'#1a8047' }}>Sent successfully</p>
              {explorerUrl && (
                <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
                  style={{ color:'#6b6580' }}>
                  View on ArcScan <ExternalLink size={11} />
                </a>
              )}
            </div>
          </motion.div>
        )}

        {/* Error */}
        {txState === 'error' && txError && (
          <motion.div
            initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}
            className="flex items-start gap-3 rounded-2xl p-4"
            style={{ background:'rgba(186,43,76,0.07)', border:'1px solid rgba(186,43,76,0.18)' }}
          >
            <AlertCircle size={18} style={{ color:'#ba2b4c', flexShrink:0, marginTop:1 }} />
            <p className="text-sm" style={{ color:'#ba2b4c' }}>{txError.slice(0, 200)}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
