/**
 * Netlify Function: the agent's only door to MiniMax.
 *
 * MINIMAX_APIKEY is read from the server environment and never leaves this
 * process. Note the absence of a `VITE_` prefix on purpose: Vite inlines every
 * `VITE_*` variable into the client bundle at build time, so a key named that
 * way would be published to the internet with the JavaScript. A Circle *client*
 * key is meant to travel that way; an inference key is not.
 *
 * This function never touches the wallet. It can only produce a plan. Tool
 * execution happens in the browser, where the passkey lives — the signing key is
 * device-bound, so no model output can authorise a transfer by itself.
 */

const MINIMAX_BASE = 'https://api.minimax.io/v1'
const DEFAULT_MODEL = 'MiniMax-M2.7'

/** Cap a single turn so one request cannot burn an unbounded amount. */
const MAX_TOKENS = 800

/** Longest prompt we will forward. Long input is a billing bug, not a use case. */
const MAX_INPUT_BYTES = 16_000

interface NetlifyEvent {
  httpMethod: string
  body: string | null
  headers: Record<string, string | undefined>
}

interface NetlifyResult {
  statusCode: number
  headers?: Record<string, string>
  body: string
}

function json(status: number, payload: unknown): NetlifyResult {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // The answer depends on the live key and the balance behind it.
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(payload),
  }
}

/**
 * Reject calls that did not come from this site.
 *
 * A public endpoint that spends paid credits is an open relay: anyone who
 * learns the URL can drain the balance. Origin is forgeable outside a browser,
 * so this is a cost control, not an authentication mechanism — real rate
 * limiting belongs in front of this function.
 */
function originAllowed(event: NetlifyEvent): boolean {
  const site = process.env.URL
  const origin = event.headers['origin']
  // No configured site URL means no allowlist to enforce; fail closed instead of
  // silently serving an open proxy.
  if (!site) return false
  if (!origin) return false // same-origin server-to-server is not a browser flow
  try {
    return new URL(origin).host === new URL(site).host
  } catch {
    return false
  }
}

export const handler = async (event: NetlifyEvent): Promise<NetlifyResult> => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: { 'Allow': 'POST, OPTIONS' },
      body: '',
    }
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' })

  if (!originAllowed(event)) return json(403, { error: 'origin_not_allowed' })

  const key = process.env.MINIMAX_APIKEY
  if (!key) return json(500, { error: 'missing_MINIMAX_APIKEY' })

  let parsed: unknown
  try {
    parsed = JSON.parse(event.body ?? '')
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  const { messages, model } = (parsed ?? {}) as { messages?: unknown; model?: string }
  if (!Array.isArray(messages) || messages.length === 0) {
    return json(400, { error: 'messages_required' })
  }
  const payloadBytes = Buffer.byteLength(JSON.stringify(messages), 'utf8')
  if (payloadBytes > MAX_INPUT_BYTES) {
    return json(413, { error: 'prompt_too_large', bytes: payloadBytes, limit: MAX_INPUT_BYTES })
  }

  // Only forward messages that look like chat turns, and only the fields the
  // protocol actually defines. An agent client must not be able to smuggle
  // arbitrary keys (or a tool payload we then trust) through this shape.
  const safeMessages = messages
    .filter(
      (m): m is { role: string; content: string } =>
        typeof m === 'object' && m !== null &&
        typeof (m as { role?: unknown }).role === 'string' &&
        typeof (m as { content?: unknown }).content === 'string',
    )
    .slice(-24)
    .map((m) => ({
      role: ['system', 'user', 'assistant'].includes(m.role) ? m.role : 'user',
      content: m.content.slice(0, 8000),
    }))

  if (safeMessages.length === 0) return json(400, { error: 'no_valid_messages' })

  let upstream: Response
  try {
    upstream = await fetch(`${MINIMAX_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: typeof model === 'string' && /^[\w.-]{1,64}$/.test(model) ? model : DEFAULT_MODEL,
        messages: safeMessages,
        max_tokens: MAX_TOKENS,
      }),
    })
  } catch {
    return json(502, { error: 'upstream_unreachable' })
  }

  const text = await upstream.text()

  // Pass the status through, but translate the ones the UI can act on. The raw
  // upstream body is returned only on success — an error body can echo request
  // context, and this function has no business forwarding that verbatim.
  if (!upstream.ok) {
    if (upstream.status === 402) {
      return json(402, {
        error: 'insufficient_balance',
        message: 'MiniMax account has no inference credit. Top up the API balance.',
      })
    }
    if (upstream.status === 401 || upstream.status === 403) {
      return json(502, { error: 'upstream_rejected_key' })
    }
    if (upstream.status === 429) return json(429, { error: 'rate_limited_upstream' })
    return json(502, { error: 'upstream_error', status: upstream.status })
  }

  try {
    return json(200, JSON.parse(text))
  } catch {
    return json(502, { error: 'upstream_returned_non_json' })
  }
}