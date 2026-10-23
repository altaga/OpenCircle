/**
 * SessionPersistenceWarning — "your wallet may be cleared soon" banner.
 *
 * Surfaced when a returning visitor has not installed the PWA and the gap
 * since their last visit is approaching Safari ITP's 7-day cap. Installing
 * the app is the only way to defeat the cap; the banner delegates the
 * install flow to `usePwaInstall`, exactly the same way `InstallBanner` does,
 * so there is one source of truth for the install copy.
 */
import { useState } from 'react'
import { Download, Share, PlusSquare, X, AlertTriangle } from 'lucide-react'
import { isIosSafari, usePwaInstall } from '@/lib/use-pwa-install'
import { useSessionPersistence } from '@/hooks/useSessionPersistence'

export function SessionPersistenceWarning({ className = '' }: { className?: string }) {
  const { shouldWarn, daysSinceLastVisit } = useSessionPersistence()
  const { canPrompt, installed, install } = usePwaInstall()
  const [showIOSHelp, setShowIOSHelp] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  // Mount-only dismissal: a refresh of the page should not re-show the banner
  // immediately. sessionStorage would be too aggressive (re-shows on every
  // tab) and localStorage would be wrong (the warning is about localStorage
  // being wiped). A boolean in React state for the lifetime of this component
  // is the smallest unit that does the right thing.
  if (!shouldWarn || installed || dismissed) return null

  const ios = isIosSafari()
  if (!canPrompt && !ios) return null

  const days =
    daysSinceLastVisit !== null
      ? `It's been ${daysSinceLastVisit} day${daysSinceLastVisit === 1 ? '' : 's'}.`
      : "It's been a while."

  const glass = {
    background: 'rgba(255,243,224,0.78)',
    backdropFilter: 'blur(28px) saturate(180%)',
    WebkitBackdropFilter: 'blur(28px) saturate(180%)',
    border: '1px solid rgba(255,205,131,0.42)',
    boxShadow: '0 8px 32px rgba(143,86,18,0.10)',
  } as React.CSSProperties

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-start gap-3 rounded-2xl p-3.5 ${className}`}
      style={glass}
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: '#a06400' }} />

      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold" style={{ color: '#7a4a00' }}>
          Your wallet could be cleared
        </p>
        <p className="mt-0.5 text-xs" style={{ color: '#8a5a14' }}>
          {days} If you don't install, Safari may erase your remembered wallet.
        </p>

        {showIOSHelp && (
          <ol className="mt-2 space-y-1 text-xs" style={{ color: '#8a5a14' }}>
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
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white transition-all active:scale-95"
            style={{ background: '#7a4a00' }}
          >
            <PlusSquare size={12} /> {showIOSHelp ? 'Got it' : 'How?'}
          </button>
        ) : (
          <button
            onClick={() => void install()}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white transition-all active:scale-95"
            style={{ background: '#7a4a00' }}
          >
            <Download size={12} /> Install
          </button>
        )}
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss session-persistence warning"
          className="rounded-lg p-1 transition-opacity hover:opacity-60"
          style={{ color: '#8a5a14' }}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
