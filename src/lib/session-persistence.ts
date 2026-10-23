/**
 * session-persistence — tracks the last time the app was opened on this origin.
 *
 * This is not security-sensitive. A single timestamp in localStorage is enough
 * to detect a return after several days, which is the signal the
 * `SessionPersistenceWarning` banner uses to nudge the user toward installing
 * the PWA. Installing it is the only thing that actually defeats Safari ITP's
 * 7-day cap on script-writable storage (Apple exempts Home Screen web apps).
 *
 * localStorage is the right home for this value — it lives in the same channel
 * that the warning itself is about, so a wipe of the channel produces a
 * "no last visit" state, which is exactly the "warning should fire" condition.
 * If we put it in IndexedDB instead, an ITP wipe would silently zero it out
 * without triggering the warning.
 *
 * The value is a plain number (ms since epoch). It is never sent off-device.
 */
const LAST_VISIT_KEY = 'oc_last_visit'

/** How many days of inactivity should trigger the install prompt. Safari's ITP cap is 7. */
export const PERSISTENCE_WARNING_DAYS = 5

/** Read the last-visit timestamp (ms), or null if unknown / wiped / never recorded. */
export function getLastVisit(): number | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(LAST_VISIT_KEY)
    if (!raw) return null
    const n = Number.parseInt(raw, 10)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

/** Persist the current time as the most recent visit. Best-effort; never throws. */
export function setLastVisit(timestamp: number = Date.now()): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(LAST_VISIT_KEY, String(timestamp))
  } catch {
    // Quota, private mode, blocked — none of these are worth surfacing;
    // the warning just won't fire this session.
  }
}

/** Whole days elapsed since `lastVisit` (rounded down). Returns Infinity if unknown. */
export function daysSince(lastVisit: number | null, now: number = Date.now()): number {
  if (lastVisit === null) return Number.POSITIVE_INFINITY
  return Math.floor((now - lastVisit) / 86_400_000)
}
