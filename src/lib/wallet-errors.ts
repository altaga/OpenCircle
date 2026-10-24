/**
 * wallet-errors — turn SDK noise into something a person can act on.
 *
 * Circle's Modular Wallets SDK surfaces raw JSON-RPC failures, and viem wraps
 * some of them as "An unknown RPC error occurred. Details: … Version: viem@x.y.z".
 * None of that tells anyone what to do next. Every rule here produces a plain
 * sentence plus the action to take, scrubbed on the way out so a payload can
 * never carry the client key to the screen.
 */

import { CLIENT_KEY } from '@/lib/circle-config'

const REDACTED = '[REDACTED]'

/**
 * Strip the client key out of any text bound for the screen or the console.
 *
 * Not a debug aid — a last line of defence. Circle echoes request context back
 * in some error payloads, and nothing that reaches a user-facing string should
 * be able to carry the credential with it.
 */
export function scrub(input: string): string {
  if (!CLIENT_KEY) return input
  let out = input
  if (out.includes(CLIENT_KEY)) out = out.split(CLIENT_KEY).join(REDACTED)
  return out
}

/** Longest user-facing error. Bounded here so callers never have to clip. */
const MAX_LENGTH = 220

/**
 * First match wins, so the order is most-specific-first: a duplicated username
 * is a name clash, not a credential problem, even though both arrive from the
 * same JSON-RPC transport.
 */
const RULES: ReadonlyArray<{ test: RegExp; message: string }> = [
  {
    test: /username is duplicated/i,
    message:
      'A wallet with that name already exists on Circle. Switch to "Sign in" to open it, or pick a different name.',
  },
  {
    test: /invalid credentials|unauthorized|status:\s*401|status code 401/i,
    message:
      'Circle rejected the client key for this network. Check VITE_CLIENT_KEY_MAINNET in Netlify and rebuild.',
  },
  {
    test: /api parameter invalid|invalid parameter|invalid request/i,
    message:
      'Circle accepted the client key but rejected the request. Reload the page — if it persists, the app is sending something malformed.',
  },
  {
    test: /invalid authenticator|credential[^.]*(not found|does not exist|no credential)/i,
    message:
      'This device has no passkey for that wallet. Create one under a new name, or sign in from the device that made it.',
  },
  {
    test: /secure context|https is required|only on https/i,
    message: 'Passkeys only work over HTTPS (or on localhost). Open the app on its real domain.',
  },
  {
    test: /notallowederror|not allowed|timed out or was not allowed|user (cancell|abort|dismiss|declin)/i,
    message: 'The passkey prompt was dismissed or timed out. Tap the button again to retry.',
  },
  {
    test: /failed to fetch|networkerror|network error|load failed|econnrefused|err_internet/i,
    message: 'Could not reach Circle. Check your connection and try again.',
  },
]

/** Drop viem's wrapper so the fallback shows Circle's own wording. */
function unwrap(raw: string): string {
  return raw
    .replace(/^An unknown RPC error occurred\.\s*Details:\s*/i, '')
    .replace(/\s*Version:\s*\S+$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function clip(text: string): string {
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1).trimEnd()}…` : text
}

/**
 * Map a thrown value to a user-facing sentence.
 *
 * Never returns a secret: `scrub` runs over both the raw text and the fallback
 * before anything leaves this function.
 */
export function friendlyWalletError(err: unknown, _ctx: { username?: string } = {}): string {
  const errMsg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : err && typeof err === 'object' && 'message' in err && typeof (err as Record<string, unknown>).message === 'string'
          ? ((err as Record<string, unknown>).message as string)
          : ''
  const raw = scrub(errMsg)
  const name = err instanceof Error ? err.name : ''

  const nameHint =
    name === 'NotAllowedError' || name === 'AbortError'
      ? 'The passkey prompt was dismissed or timed out. Tap the button again to retry.'
      : ''

  const rule = RULES.find((r) => r.test.test(raw))
  if (rule) return clip(rule.message)
  if (nameHint) return nameHint

  const clean = unwrap(raw)
  if (!clean) return 'Something went wrong. Try again.'
  return clip(`Circle returned an unexpected response: ${clean}`)
}