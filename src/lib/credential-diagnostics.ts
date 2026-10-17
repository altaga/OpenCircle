/**
 * Credential diagnostics — safe by construction.
 *
 * Nothing in this file returns, logs or serialises a secret. Every field it
 * produces is a boolean, an enum, or a bucketed size. `scrub()` is a second
 * line of defence applied to any text that reaches the console.
 *
 * Why this exists: Circle answers every auth problem with the same bare
 * "Invalid credentials", which looks identical for a misconfigured build, a
 * wrong variable name, a testnet key used against mainnet, and a revoked key.
 * These diagnostics tell those apart without ever putting the key on screen.
 *
 * The probe replays the exact request shape that
 * `@circle-fin/modular-wallets-core` uses (POST + `Authorization: Bearer …`),
 * so its verdict reflects what the real transport would see.
 */

// ── Secret registry (never exported) ──────────────────────────────────────────
const SECRET_VALUES: string[] = [
  import.meta.env.VITE_CLIENT_KEY_MAINNET,
  import.meta.env.VITE_CLIENT_KEY,
].filter((v): v is string => typeof v === 'string' && v.length > 0)

const REDACTED = '[REDACTED]'

/** Strip any known secret out of arbitrary text before it is logged. */
export function scrub(input: string): string {
  let out = input
  for (const secret of SECRET_VALUES) {
    if (out.includes(secret)) out = out.split(secret).join(REDACTED)
  }
  return out
}

// ── Static report ────────────────────────────────────────────────────────────

export type KeyKind = 'live' | 'test' | 'unrecognized' | 'missing'
export type LengthBucket = 'none' | 'short' | 'typical' | 'long'

export interface CredentialReport {
  keyPresent:   boolean
  keyKind:      KeyKind
  keyLength:    LengthBucket
  urlPresent:   boolean
  urlIsCircle:  boolean
  network:      string
  chainId:      number
  chainPath:    string
}

export interface CredentialTarget {
  clientKey: string
  network: string
  chainId: number
  chainPath: string
}

/** Resolved here so callers can pass the network config unchanged. */
function clientUrl(): string {
  return (import.meta.env.VITE_CLIENT_URL as string) ?? ''
}

function classifyKey(key: string): KeyKind {
  if (!key) return 'missing'
  // Circle ships two shapes: the legacy single-token API key
  // (LIVE_API_KEY:…) and the Modular SDK client key
  // (LIVE_CLIENT_KEY:<uuid>:<uuid>). Both are valid for their SDK.
  if (/^LIVE_(API_KEY|CLIENT_KEY)[:_]/i.test(key)) return 'live'
  if (/^TEST_(API_KEY|CLIENT_KEY)[:_]/i.test(key)) return 'test'
  return 'unrecognized'
}

/** Modular SDK client keys carry two UUID segments after the prefix. */
function isClientKeyPair(key: string): boolean {
  const parts = key.split(':')
  return parts.length === 3 && /^[0-9a-f]{32}$/i.test(parts[1] ?? '') && /^[0-9a-f]{32}$/i.test(parts[2] ?? '')
}

function bucketLength(n: number): LengthBucket {
  if (n === 0) return 'none'
  if (n < 40) return 'short'
  if (n <= 200) return 'typical'
  return 'long'
}

/** Cheap, offline, no network. Safe to run on every page load. */
export function describeCredential(t: CredentialTarget): CredentialReport {
  const key = t.clientKey ?? ''
  const url = clientUrl()
  return {
    keyPresent:  key.length > 0,
    keyKind:     classifyKey(key),
    keyLength:   bucketLength(key.length),
    urlPresent:  Boolean(url),
    urlIsCircle: url.startsWith('https://modular-sdk.circle.com/'),
    network:     t.network,
    chainId:     t.chainId,
    chainPath:   t.chainPath,
  }
}

// ── Live probe ───────────────────────────────────────────────────────────────

export type ProbeVerdict = 'accepted' | 'rejected' | 'unreachable' | 'skipped'

export interface ProbeResult {
  verdict: ProbeVerdict
  status:  number | null
  reason:  string
  ms:      number
}

/** A method name Circle does not implement: auth is still checked first, but
 *  nothing can be created, changed or read even if it ever is. */
const PROBE_METHOD = '__opencircle_credential_probe__'

function reasonFrom(status: number, body: string): string {
  const text = scrub(body).replace(/\s+/g, ' ').trim().slice(0, 140)
  const rejected = status === 401 || status === 403
  return `${rejected ? 'auth rejected' : 'auth passed'} (HTTP ${status}) ${text}`
}

/**
 * Ask Circle whether it accepts the configured credential.
 *
 * `accepted` means the 401/403 gate was passed — a rejection here is Circle's
 * server refusing the key, not the app misbehaving.
 */
export async function probeCredential(
  baseUrl: string,
  clientKey: string,
  chainPath: string,
  timeoutMs = 8000,
): Promise<ProbeResult> {
  if (!baseUrl || !clientKey) {
    return { verdict: 'skipped', status: null, reason: 'missing url or key', ms: 0 }
  }
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${baseUrl}${chainPath}`, {
      method: 'POST',
      signal: controller.signal,
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clientKey}`,
        'X-AppInfo': `platform=web;diagnostic=credential-probe;uri=${location.hostname}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method: PROBE_METHOD }),
    })
    const body = await res.text().catch(() => '')
    return {
      verdict: res.status === 401 || res.status === 403 ? 'rejected' : 'accepted',
      status:  res.status,
      reason:  reasonFrom(res.status, body),
      ms:      Date.now() - started,
    }
  } catch (err) {
    const why = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    return {
      verdict: 'unreachable',
      status:  null,
      reason:  scrub(why).slice(0, 160),
      ms:      Date.now() - started,
    }
  } finally {
    clearTimeout(timer)
  }
}

// ── Safe logging ─────────────────────────────────────────────────────────────

export interface SafeError {
  scope:   string
  name:    string
  message: string
  status:  number | null
}

/** Log an error reduced to safe fields. Never logs a stack or a payload. */
export function logSafeError(scope: string, err: unknown): SafeError {
  const e = err as { name?: string; message?: string; status?: number } | null
  const info: SafeError = {
    scope,
    name:    e?.name ?? 'UnknownError',
    message: scrub(String(e?.message ?? err ?? '')).slice(0, 300),
    status:  typeof e?.status === 'number' ? e.status : null,
  }
  console.warn('[cred-diag] error', info)
  return info
}

// ── Wiring ───────────────────────────────────────────────────────────────────

let reported = false
let lastProbe: Promise<ProbeResult> | null = null

/** One-shot static report at startup. No network, no secrets. */
export function reportCredentials(t: CredentialTarget): CredentialReport | null {
  if (reported) return null
  reported = true
  const report = describeCredential(t)
  console.info('[cred-diag] credential report', report)
  return report
}

/** Probe once per session; repeated failures reuse the first result. */
export function runProbe(t: CredentialTarget): Promise<ProbeResult> {
  lastProbe ??= probeCredential(clientUrl(), t.clientKey, t.chainPath).then((result) => {
    console.info('[cred-diag] circle auth probe', result)
    return result
  })
  return lastProbe
}

/** Manual access from the browser console: `__openCircleDiagnostics.probe()`. */
export function exposeDiagnostics(t: CredentialTarget): void {
  if (typeof window === 'undefined') return
  ;(window as unknown as Record<string, unknown>).__openCircleDiagnostics = {
    report: () => describeCredential(t),
    probe:  () => probeCredential(clientUrl(), t.clientKey, t.chainPath),
    scrub,
  }
}
