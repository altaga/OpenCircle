/**
 * Credential storage — IndexedDB primary, with a localStorage mirror as
 * belt-and-suspenders. IndexedDB is the source of truth; the mirror is a
 * fallback for the case where IndexedDB itself is unavailable.
 *
 * Why IndexedDB and not localStorage: Safari's ITP applies its 7-day cap to
 * script-writable storage. An honest caveat — IndexedDB is covered by that
 * cap too, so moving off localStorage does not by itself defeat it. What
 * does is *installing the PWA*: Apple exempts Home Screen web apps, which
 * is why `requestPersistentStorage()` and the install prompt live here too.
 * IndexedDB is still the right base — far larger quota, async so it never
 * blocks first paint, and no JSON round trip.
 *
 * Why a localStorage mirror at all: the mirror is *not* a separate encrypted
 * channel — there is no encrypted channel, because the stored blob is a
 * WebAuthn *public* credential (the credential id and the P-256 public key).
 * The signing key never leaves the authenticator (TPM, Secure Enclave,
 * Android Keystore), so this is not key material and cannot sign on its
 * own. The mirror's job is purely robustness: if IndexedDB is blocked
 * (privacy extension, blocked storage, a private-mode quirk we have not yet
 * seen), `readCredential` consults the mirror so the user does not silently
 * land on the sign-in card. The mirror is also under Safari ITP — it does
 * not replace the PWA install.
 *
 * What is stored is the same in both places: a WebAuthn public credential,
 * a network identifier, the smart account address, and the "remember me on this device" preference.
 * Persisting them only removes the prompt needed to *open* the wallet —
 * every send still goes through `navigator.credentials.get()`.
 */

import type { WebAuthnCredential } from '@circle-fin/modular-wallets-core'
import type { Hex } from 'viem'

const DB_NAME = 'opencircle'
const DB_VERSION = 1
const STORE = 'wallets'

/** Per-tab ownership marker. A boolean, never the credential. */
const tabKey = (network: string) => `oc_tab_${network}`

/**
 * The part of a WebAuthn credential that can actually be persisted.
 *
 * `raw` is deliberately absent. It is the live `PublicKeyCredential` platform
 * object, and the structured-clone algorithm refuses to clone it — IndexedDB
 * rejects the entire record with a DataCloneError ("PublicKeyCredential object
 * could not be cloned"). Nothing in the app reads it either: viem's
 * `toWebAuthnAccount` only needs `id` and `publicKey`.
 */
export interface StoredCredential {
  id: string
  publicKey: string
  rpId?: string
  address?: Hex
}

interface WalletRecord {
  network: string
  credential: StoredCredential
  remember: boolean
}

/** Project a live credential down to the persistable half. */
function toStorable(cred: WebAuthnCredential | StoredCredential, address?: Hex): StoredCredential {
  const pk = cred.publicKey.startsWith('0x') ? cred.publicKey : `0x${cred.publicKey}`
  return {
    id: cred.id,
    publicKey: pk,
    rpId: cred.rpId,
    address: address ?? (cred as StoredCredential).address,
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

/** CRIT-01: rejects anything that fails the expected shape (e.g. XSS-injected). */
export function isValidCredentialShape(obj: unknown): obj is StoredCredential {
  if (typeof obj !== 'object' || obj === null) return false
  const c = obj as Record<string, unknown>
  const basic = (
    typeof c.id === 'string' && c.id.length > 0 &&
    typeof c.publicKey === 'string' &&
    (/^0x[0-9a-fA-F]+$/.test(c.publicKey) || /^[0-9a-fA-F]+$/.test(c.publicKey))
  )
  if (!basic) return false
  if (c.address !== undefined && c.address !== null) {
    if (typeof c.address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(c.address)) {
      return false
    }
  }
  return true
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

function releaseTab(network: string): void {
  try { sessionStorage.removeItem(tabKey(network)) } catch { /* private mode */ }
}

// ── Web mirror (localStorage fallback) ───────────────────────────────────────

/** Per-network key for the localStorage mirror. */
const mirrorKey = (network: string) => `oc_wallet_mirror_${network}`

/** Read the mirror for `network`. Returns null on any error or shape failure. */
function getWebMirror(network: string): WalletRecord | null {
  try {
    const raw = localStorage.getItem(mirrorKey(network))
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const r = parsed as Partial<WalletRecord>
    if (!isValidCredentialShape(r.credential)) return null
    return { network, credential: r.credential, remember: r.remember === true }
  } catch {
    return null
  }
}

/** Write the mirror for `network`. Silently ignores quota / blocked errors. */
function setWebMirror(network: string, rec: WalletRecord): void {
  try {
    localStorage.setItem(mirrorKey(network), JSON.stringify(rec))
  } catch {
    // localStorage quota, Safari private mode, or an extension blocked it.
    // The mirror is best-effort; IDB remains the source of truth.
  }
}

/** Remove the mirror for `network`. Silent on errors. */
function clearWebMirror(network: string): void {
  try {
    localStorage.removeItem(mirrorKey(network))
  } catch {
    // ignore
  }
}

// ── Cookie mirror (fallback for partitioned / iframe storage) ────────────────

const cookieKey = (network: string) => `oc_wallet_${network}`

function getCookieMirror(network: string): WalletRecord | null {
  if (typeof document === 'undefined') return null
  try {
    const name = `${cookieKey(network)}=`
    const decoded = decodeURIComponent(document.cookie)
    const parts = decoded.split(';')
    for (const part of parts) {
      const trimmed = part.trim()
      if (trimmed.startsWith(name)) {
        const val = trimmed.slice(name.length)
        const parsed: unknown = JSON.parse(val)
        if (typeof parsed !== 'object' || parsed === null) return null
        const r = parsed as Partial<WalletRecord>
        if (!isValidCredentialShape(r.credential)) return null
        return { network, credential: r.credential, remember: r.remember === true }
      }
    }
    return null
  } catch {
    return null
  }
}

function setCookieMirror(network: string, rec: WalletRecord): void {
  if (typeof document === 'undefined') return
  try {
    const val = encodeURIComponent(JSON.stringify(rec))
    const isHttps = typeof location !== 'undefined' && location.protocol === 'https:'
    const secureFlag = isHttps ? '; Secure' : ''
    const isIframe = typeof window !== 'undefined' && window.self !== window.top
    const samesite = isIframe ? 'None' : 'Lax'
    document.cookie = `${cookieKey(network)}=${val}; max-age=31536000; path=/; SameSite=${samesite}${secureFlag}`
  } catch {
    // cookies disabled or quota reached
  }
}

function clearCookieMirror(network: string): void {
  if (typeof document === 'undefined') return
  try {
    const isHttps = typeof location !== 'undefined' && location.protocol === 'https:'
    const secureFlag = isHttps ? '; Secure' : ''
    const isIframe = typeof window !== 'undefined' && window.self !== window.top
    const samesite = isIframe ? 'None' : 'Lax'
    document.cookie = `${cookieKey(network)}=; max-age=0; path=/; SameSite=${samesite}${secureFlag}`
  } catch {
    // ignore
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * The credential this context may use, or null.
 *
 * If a valid credential exists on this device, it is restored immediately
 * so the user stays signed into their wallet across refreshes.
 */
export async function readCredential(network: string): Promise<StoredCredential | null> {
  let rec: WalletRecord | null = null
  try {
    rec = await get(network)
  } catch {
    // IDB itself failed (open error, blocked, private-mode quirk).
    rec = null
  }

  if (!rec) {
    rec = getWebMirror(network)
  }

  if (!rec) {
    rec = getCookieMirror(network)
  }

  if (!rec) return null
  markTab(network)
  return rec.credential
}

/** Persist the credential and whether this device should remember it. */
export async function writeCredential(
  network: string,
  cred: WebAuthnCredential | StoredCredential,
  remember: boolean,
  address?: Hex,
): Promise<void> {
  markTab(network)
  if (remember) await requestPersistentStorage()
  const rec: WalletRecord = { network, credential: toStorable(cred, address), remember }
  try {
    await put(rec)
  } catch (err) {
    console.warn(
      '[credential-store] IndexedDB write failed; falling back to the localStorage mirror.',
      err,
    )
  }
  setWebMirror(network, rec)
  setCookieMirror(network, rec)
}

/** Turn device persistence on/off without forcing a re-auth. */
export async function setRemember(network: string, on: boolean): Promise<void> {
  let rec: WalletRecord | null = null
  try {
    rec = await get(network)
  } catch {
    rec = null
  }
  if (!rec) rec = getWebMirror(network)
  if (!rec) rec = getCookieMirror(network)
  if (!rec) return
  if (on) markTab(network)
  const updated: WalletRecord = { ...rec, remember: on }
  try {
    await put(updated)
    if (on) await requestPersistentStorage()
  } catch {
    // IDB write failed; mirror below keeps the state alive
  }
  setWebMirror(network, updated)
  setCookieMirror(network, updated)
}

/** Currently persisted preference, so the toggle can hydrate its initial value. */
export async function readRemember(network: string): Promise<boolean> {
  let rec: WalletRecord | null = null
  try {
    rec = await get(network)
  } catch {
    rec = null
  }
  if (!rec) rec = getWebMirror(network)
  if (!rec) rec = getCookieMirror(network)
  return rec ? rec.remember !== false : true
}

/** Sign out: drop the credential, the preference, the tab marker, the mirror, and the cookie. */
export async function forgetCredential(network: string): Promise<void> {
  releaseTab(network)
  clearWebMirror(network)
  clearCookieMirror(network)
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
