/**
 * usePwaInstall — install affordance for the Home Screen app.
 *
 * Chromium fires `beforeinstallprompt`, which we stash and replay behind a
 * button. iOS Safari fires nothing, so that platform gets manual Share →
 * "Add to Home Screen" instructions instead.
 *
 * This matters for correctness, not just polish: Safari exempts Home Screen
 * web apps from the 7-day eviction cap on script-writable storage. Without an
 * install, a remembered wallet in IndexedDB can still be swept up, which is the
 * exact failure IndexedDB alone does not prevent.
 */

import { useCallback, useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone
  return window.matchMedia('(display-mode: standalone)').matches || iosStandalone === true
}

/** iOS Safari only — Chrome/Firefox/Edge on iOS cannot install a PWA. */
export function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Macintosh') && typeof document !== 'undefined' && 'ontouchend' in document)
  const isOtherEngine = /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
  return isIos && !isOtherEngine
}

export function usePwaInstall(): {
  canPrompt: boolean
  installed: boolean
  install: () => Promise<void>
} {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(isStandalone)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Chromium shows its own mini-infobar unless the event is prevented.
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setDeferred(null)
    }

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = useCallback(async () => {
    if (!deferred) return
    try {
      await deferred.prompt()
      await deferred.userChoice
    } catch {
      // User dismissed, or the prompt was already consumed.
    }
    setDeferred(null)
  }, [deferred])

  return { canPrompt: deferred !== null, installed, install }
}