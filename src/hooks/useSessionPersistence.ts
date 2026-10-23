/**
 * useSessionPersistence — surfaces a warning when a returning user is close
 * to Safari ITP's 7-day cap, and the app is not installed as a PWA.
 *
 * The hook records the current visit on mount and reports how long it has
 * been since the previous one. The component consumes the result and decides
 * whether to render a banner. The check is intentionally a soft threshold
 * (default 5 of 7 days) so the user has time to act.
 *
 * Why this lives outside `credential-store`: the credential is a security
 * object; this timestamp is not. Mixing the two in IDB would couple two
 * unrelated lifecycles, and the credential is exactly the thing that has to
 * survive ITP if anything is going to.
 */
import { useEffect, useState } from 'react'
import {
  PERSISTENCE_WARNING_DAYS,
  daysSince,
  getLastVisit,
  setLastVisit,
} from '@/lib/session-persistence'
import { usePwaInstall } from '@/lib/use-pwa-install'

export interface SessionPersistenceState {
  /** True if the user should be warned about the ITP eviction risk. */
  shouldWarn: boolean
  /** True if the app is installed (standalone display mode). */
  installed: boolean
  /** Days since last visit, or null if unknown / never recorded. */
  daysSinceLastVisit: number | null
}

export function useSessionPersistence(): SessionPersistenceState {
  const { installed } = usePwaInstall()
  const [lastVisit, setLastVisitState] = useState<number | null>(null)

  useEffect(() => {
    // Read first, then write — that way `lastVisit` reflects the *previous*
    // visit on the first render and the new one on subsequent renders. A
    // wipe of localStorage shows up as null and triggers the warning, which
    // is the right behavior (the channel is already gone).
    const previous = getLastVisit()
    setLastVisit()
    setLastVisitState(previous)
  }, [])

  const elapsed = daysSince(lastVisit)
  const shouldWarn =
    !installed &&
    lastVisit !== null &&                    // never recorded → no need to nag a first-time visitor
    elapsed >= PERSISTENCE_WARNING_DAYS

  return {
    shouldWarn,
    installed,
    daysSinceLastVisit: lastVisit === null ? null : elapsed,
  }
}
