/**
 * InstallBanner — offers the Home Screen install, or iOS instructions.
 *
 * Only rendered when there is something to offer: already installed, or a
 * platform with no install path, renders nothing at all.
 */
import { useState } from 'react'
import { Download, Share, PlusSquare, X } from 'lucide-react'
import { isIosSafari, usePwaInstall } from '@/lib/use-pwa-install'

export function InstallBanner({ className = '' }: { className?: string }) {
  const { canPrompt, installed, install } = usePwaInstall()
  const [showIOSHelp, setShowIOSHelp] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  if (installed || dismissed) return null

  const ios = isIosSafari()
  if (!canPrompt && !ios) return null

  const glass = {
    background: 'rgba(255,255,255,0.72)',
    backdropFilter: 'blur(28px) saturate(180%)',
    WebkitBackdropFilter: 'blur(28px) saturate(180%)',
    border: '1px solid rgba(255,255,255,0.72)',
    boxShadow: '0 8px 32px rgba(18,45,69,0.10)',
  } as React.CSSProperties

  return (
    <div
      className={`flex items-start gap-3 rounded-2xl p-3.5 ${className}`}
      style={glass}
    >
      <PlusSquare size={16} className="mt-0.5 shrink-0" style={{ color: '#122d45' }} />

      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold" style={{ color: '#122d45' }}>
          Install OpenCircle
        </p>
        <p className="mt-0.5 text-xs" style={{ color: '#6b6580' }}>
          {ios
            ? 'Add it to your Home Screen so Safari stops clearing your wallet.'
            : 'Install it so your remembered wallet survives browser cleanups.'}
        </p>

        {showIOSHelp && (
          <ol className="mt-2 space-y-1 text-xs" style={{ color: '#6b6580' }}>
            <li>1. Tap the <Share size={11} className="inline align-[-1px]" /> Share button in Safari.</li>
            <li>2. Scroll and tap <strong>Add to Home Screen</strong>.</li>
            <li>3. Open OpenCircle from your Home Screen.</li>
          </ol>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {ios ? (
          <button
            onClick={() => setShowIOSHelp((v) => !v)}
            className="rounded-xl px-3 py-1.5 text-xs font-bold text-white transition-all active:scale-95"
            style={{ background: '#122d45' }}
          >
            {showIOSHelp ? 'Got it' : 'How?'}
          </button>
        ) : (
          <button
            onClick={() => void install()}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white transition-all active:scale-95"
            style={{ background: '#122d45' }}
          >
            <Download size={12} /> Install
          </button>
        )}
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss install hint"
          className="rounded-lg p-1 transition-opacity hover:opacity-60"
          style={{ color: '#8a849c' }}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}