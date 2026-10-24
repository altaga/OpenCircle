/**
 * Netlify Function: the agent's only door to MiniMax.
 *
 * MINIMAX_APIKEY is read from the server environment and never leaves this
 * process. Note the absence of a `VITE_` prefix on purpose: Vite inlines every
 * `VITE_*` variable into the client bundle at build time, so a key named that
 * way would be published to the internet with the JavaScript. A Circle *client*
 * key is meant to travel that way; an inference key is not.
 *
 * This function never touches the wallet. It only produces a plan. Tool
 * execution happens in the browser, where the passkey lives — the signing key is
 * device-bound, so no model output can authorise a transfer by itself.
 *
 * Uses the Anthropic-compatible route rather than the OpenAI-compatible one.
 * Both work; the OpenAI route inlines `<think>` blocks into `content`, which
 * would leak reasoning into text the user reads. Here thinking arrives as its
 * own content block and is returned under a separate key.
 */

import { AGENT_TOOLS_ANTHROPIC } from '../../src/lib/agent-tools-schema'

/**
 * Base URL — a constant, deliberately not read from the environment.
 *
 * MINIMAX_APIKEY is the only variable this function consumes, and it exists
 * only because a real credential cannot be hardcoded.
 *
 * Note the path is `/anthropic`, not `/v1`. Both routes work and both were
 * exercised with tool calling, but the OpenAI-compatible one inlines `<think>`
 * blocks into `content` — the reasoning would end up in the text the user
 * reads. Here thinking arrives as its own content block and comes back under
 * a separate field.
 */
const MINIMAX_BASE_URL = 'https://api.minimax.io/anthropic'
const DEFAULT_MODEL = 'MiniMax-M3'

/** Cap one turn so a single request cannot burn an unbounded amount. */
const MAX_TOKENS = 800

/** Longest prompt we forward. Long input is a billing bug, not a use case. */
const MAX_INPUT_BYTES = 16_000

/** Most turns we keep. Older ones are dropped rather than truncated. */
const MAX_TURNS = 24

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
  if (!origin) return false
  if (!site) {
    try {
      const u = new URL(origin)
      return u.hostname === 'localhost' || u.hostname === '127.0.0.1'
    } catch {
      return false
    }
  }
  try {
    return new URL(origin).host === new URL(site).host
  } catch {
    return false
  }
}

/** Collapse the Anthropic block list into a shape the browser can use directly. */
function normalise(payload: {
  stop_reason?: string
  content?: Array<Record<string, unknown>>
  usage?: Record<string, unknown>
  model?: string
}) {
  let text = ''
  let thinking = ''
  const toolCalls: Array<{ id: string; name: string; input: unknown }> = []

  for (const block of payload.content ?? []) {
    switch (block.type) {
      case 'text':
        text += String(block.text ?? '')
        break
      case 'thinking':
        thinking += String(block.thinking ?? '')
        break
      case 'tool_use':
        toolCalls.push({
          id: String(block.id ?? ''),
          name: String(block.name ?? ''),
          input: block.input ?? {},
        })
        break
      default:
        // Unknown block types are ignored, not forwarded blindly.
        break
    }
  }

  return {
    model: payload.model ?? DEFAULT_MODEL,
    stopReason: payload.stop_reason ?? 'end_turn',
    text: text.trim(),
    thinking: thinking.trim() || null,
    toolCalls,
    usage: payload.usage ?? null,
  }
}

export const handler = async (event: NetlifyEvent): Promise<NetlifyResult> => {
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

  const { messages, system, model } = (parsed ?? {}) as {
    messages?: unknown
    system?: unknown
    model?: string
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return json(400, { error: 'messages_required' })
  }
  if (Buffer.byteLength(JSON.stringify(messages), 'utf8') > MAX_INPUT_BYTES) {
    return json(413, { error: 'prompt_too_large' })
  }

  // Only chat turns with a string role and string content survive. An agent
  // client must not be able to smuggle arbitrary keys through this shape.
  const safeMessages = messages
    .filter(
      (m): m is { role: string; content: string } =>
        typeof m === 'object' && m !== null &&
        typeof (m as { role?: unknown }).role === 'string' &&
        typeof (m as { content?: unknown }).content === 'string',
    )
    .slice(-MAX_TURNS)
    .map((m) => ({
      role: ['user', 'assistant'].includes(m.role) ? m.role : 'user',
      content: m.content.slice(0, 8000),
    }))

  if (safeMessages.length === 0) return json(400, { error: 'no_valid_messages' })

  let upstream: Response
  try {
    upstream = await fetch(`${MINIMAX_BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: typeof model === 'string' && /^[\w.-]{1,64}$/.test(model) ? model : DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        // The catalog is server-owned. Tools supplied by the caller are ignored.
        tools: AGENT_TOOLS_ANTHROPIC,
        system: typeof system === 'string' ? system.slice(0, 2000) : undefined,
        messages: safeMessages,
      }),
    })
  } catch {
    return json(502, { error: 'upstream_unreachable' })
  }

  const text = await upstream.text()

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
    // The raw upstream body is not forwarded: an error body can echo request
    // context, and this function has no business passing that to the client.
    return json(502, { error: 'upstream_error', status: upstream.status })
  }

  try {
    return json(200, normalise(JSON.parse(text)))
  } catch {
    return json(502, { error: 'upstream_returned_unexpected_shape' })
  }
}