/**
 * ReceivePanel — show address + copyable QR placeholder.
 */
import { useState } from 'react'
import { Copy, Check, QrCode } from 'lucide-react'
import { motion } from 'framer-motion'
import type { Hex } from 'viem'

interface Props { address: Hex }

const glass = {
  card: {
    background: 'rgba(255,255,255,0.72)',
    backdropFilter: 'blur(28px) saturate(180%)',
    WebkitBackdropFilter: 'blur(28px) saturate(180%)',
    border: '1px solid rgba(255,255,255,0.72)',
    boxShadow: '0 8px 40px rgba(18,45,69,0.10), inset 0 1px 0 rgba(255,255,255,0.60)',
  } as React.CSSProperties,
}

export function ReceivePanel({ address }: Props) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    void navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="overflow-hidden rounded-3xl" style={glass.card}>
      <div className="px-5 pb-6 pt-5">
        <p className="mb-4 text-xs font-semibold uppercase tracking-widest" style={{ color:'#8a849c' }}>
          Your USDC address
        </p>

        {/* QR placeholder — shows icon with a clear "no QR library" note */}
        <div
          className="mb-5 flex h-44 w-full items-center justify-center rounded-2xl"
          style={{ background:'rgba(18,45,69,0.04)', border:'1px dashed rgba(18,45,69,0.14)' }}
        >
          <div className="text-center">
            <QrCode size={44} style={{ color:'rgba(18,45,69,0.25)', margin:'0 auto' }} />
            <p className="mt-2 text-xs" style={{ color:'rgba(18,45,69,0.35)' }}>
              QR code — add qrcode.react for production
            </p>
          </div>
        </div>

        {/* Full address — mono, selectable */}
        <div
          className="mb-4 rounded-2xl p-4"
          style={{ background:'rgba(255,255,255,0.46)', border:'1px solid rgba(255,255,255,0.56)' }}
        >
          <p className="mono select-all break-all text-sm leading-relaxed" style={{ color:'#122d45' }}>
            {address}
          </p>
        </div>

        {/* Copy button */}
        <motion.button
          onClick={copy}
          whileTap={{ scale: 0.97 }}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold transition-all"
          style={{
            background: copied ? 'rgba(26,128,71,0.12)' : '#122d45',
            color: copied ? '#1a8047' : '#fff',
          }}
        >
          {copied
            ? <><Check size={16} /> Copied to clipboard</>
            : <><Copy size={16} /> Copy address</>
          }
        </motion.button>

        <p className="mt-3 text-center text-xs" style={{ color:'#8a849c' }}>
          Send only USDC on Arc Testnet to this address
        </p>
      </div>
    </div>
  )
}
