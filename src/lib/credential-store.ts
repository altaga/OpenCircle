/**
 * Credential storage — IndexedDB, because Safari evicts script-writable storage.
 *
 * Why not localStorage: Safari's ITP applies its 7-day cap to script-writable
 * storage. An honest caveat — IndexedDB is covered by that cap too, so moving
 * off localStorage does not by itself defeat it. What does is *installing the
 * PWA*: Apple exempts Home Screen web apps, which is why `requestPersistentStorage()`
 * and the install prompt live here too. IndexedDB is still the right base —
 * far larger quota, async so it never blocks first paint, and no JSON round trip.
 *
 * What is stored is a WebAuthn *public* credential: the credential id and the
 * P-256 public key. The signing key never leaves the authenticator (TPM, Secure
 * Enclave, Android Keystore), so this is not key material and cannot sign on
 * its own. Persisting it only removes the prompt needed to *open* the wallet —
 * every send still goes through `navigator.credentials.get()`.
 *
 * Tab-vs-device is decided by a marker in sessionStorage, which holds only a
 * boolean and dies with the tab. That keeps the "remember me" preference and
 * the credential itself in IndexedDB, where they survive a browser restart.
 */

import type { WebAuthnCredential } from '@circle-fin/modular-wallets-core'

const DB_NAME = 'opencircle'
const DB_VERSION = 1
const STORE = 'wallets'

/** Per-tab ownership marker. A boolean, never the credential. */
const tabKey = (network: string) => `oc_tab_${network}`

interface WalletRecord {
  network: string
  credential: WebAuthnCredential
  remember: boolean
}

// ── Validation ───────────────────────────────────────────────────────────────

/** CRIT-01: rejects anything that fails the expected shape (e.g. XSS-injected). */
export function isValidCredentialShape(obj: unknown): obj is WebAuthnCredential {
  if (typeof obj !== 'object' || obj === null) return false
  const c = obj as Record<string, unknown>
  return (
    typeof c.id === 'string' && c.id.length > 0 &&
    typeof c.publicKey === 'string' && /^0x[0-9a-fA-F]+$/.test(c.publicKey)
  )
}

// ── IndexedDB plumbing ───────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    // Safari private mode can throw synchronously on open().
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (err) {
      reject(err instanceof Error ? err : new Error('indexedDB unavailable'))
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'network' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'))
    req.onblocked = () => reject(new Error('indexedDB open blocked'))
  })
  return dbPromise
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'))
        t.onabort = () => reject(t.error ?? new Error('indexedDB transaction aborted'))
      }),
  )
}

function put(record: WalletRecord): Promise<unknown> {
  return tx('readwrite', (s) => s.put(record))
}

function remove(network: string): Promise<unknown> {
  return tx('readwrite', (s) => s.delete(network))
}

async function get(network: string): Promise<WalletRecord | null> {
  const rec = await tx<unknown>('readonly', (s) => s.get(network))
  if (typeof rec !== 'object' || rec === null) return null
  const r = rec as Partial<WalletRecord>
  if (!isValidCredentialShape(r.credential)) return null
  return { network, credential: r.credential, remember: r.remember === true }
}

// ── Tab marker ───────────────────────────────────────────────────────────────

function markTab(network: string): void {
  try { sessionStorage.setItem(tabKey(network), '1') } catch { /* private mode */ }
}

function ownsTab(network: string): boolean {
  try { return sessionStorage.getItem(tabKey(network)) === '1' } catch { return false }
}

function releaseTab(network: string): void {
  try { sessionStorage.removeItem(tabKey(network)) } catch { /* private mode */ }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * The credential this context may use, or null.
 *
 * A tab that created or logged in owns the credential for its lifetime. Any
 * other tab only sees it when the user opted into device persistence.
 */
export async function readCredential(network: string): Promise<WebAuthnCredential | null> {
  try {
    const rec = await get(network)
    if (!rec) return null
    if (rec.remember || ownsTab(network)) {
      markTab(network)
      return rec.credential
    }
    return null
  } catch {
    return null
  }
}

/** Persist the credential and whether this device should remember it. */
export async function writeCredential(
  network: string,
  cred: WebAuthnCredential,
  remember: boolean,
): Promise<void> {
  markTab(network)
  if (remember) await requestPersistentStorage()
  try {
    await put({ network, credential: cred, remember })
  } catch {
    // The wallet still works from memory; persistence is best-effort.
  }
}

/** Turn device persistence on/off without forcing a re-auth. */
export async function setRemember(network: string, on: boolean): Promise<void> {
  let rec: WalletRecord | null = null
  try {
    rec = await get(network)
  } catch {
    // fall through
  }
  if (!rec) return
  if (on) markTab(network)
  try {
    await put({ ...rec, remember: on })
    if (on) await requestPersistentStorage()
  } catch {
    // ignore
  }
}

/** Currently persisted preference, so the toggle can hydrate its initial value. */
export async function readRemember(network: string): Promise<boolean> {
  try {
    return (await get(network))?.remember === true
  } catch {
    return false
  }
}

/** Sign out: drop the credential and the preference everywhere. */
export async function forgetCredential(network: string): Promise<void> {
  releaseTab(network)
  try {
    await remove(network)
  } catch {
    // ignore
  }
}

/**
 * Ask the browser to exempt this origin from eviction. Browsers may ignore it;
 * the installed PWA is the stronger guarantee on Safari.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}