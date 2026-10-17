/**
 * agent-client — typed wrapper around the server-side proxy.
 *
 * The browser never talks to MiniMax directly; it calls `/api/agent`, which
 * holds the key. Everything here is transport and error translation.
 */

export interface AgentToolCall {
  id: string
  name: string
  input: unknown
}

export interface AgentTurn {
  model: string
  stopReason: string
  text: string
  thinking: string | null
  toolCalls: AgentToolCall[]
}

export interface AgentChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export const AGENT_ENDPOINT = '/api/agent'

const SYSTEM_PROMPT =
  'You are the assistant inside OpenCircle, a self-custodial USDC wallet on Arc Mainnet. ' +
  'You can inspect the wallet with your tools. You cannot move funds: say so plainly when ' +
  'asked to, and point the user to the Send, Swap or Bridge tabs instead. ' +
  'Report balances and addresses exactly as the tools return them — never round, convert or ' +
  'guess. If a tool fails, say what failed instead of inventing an answer.'

/** Turn a proxy error into something worth showing a person. */
function explain(status: number, code: string): string {
  switch (code) {
    case 'insufficient_balance':
      return 'The agent has no MiniMax credit right now. Add balance in the MiniMax console.'
    case 'missing_MINIMAX_APIKEY':
      return 'The agent is not configured: MINIMAX_APIKEY is missing on the server.'
    case 'origin_not_allowed':
      return 'The agent refused the request because of its origin check.'
    case 'rate_limited_upstream':
      return 'MiniMax is rate limiting us. Try again in a moment.'
    case 'upstream_unreachable':
      return 'Could not reach MiniMax.'
    case 'upstream_rejected_key':
      return 'MiniMax rejected the server key.'
    case 'prompt_too_large':
      return 'That message is too long. Try a shorter question.'
    default:
      return status === 0
        ? 'Could not reach the agent service.'
        : `The agent service returned an error (${status}).`
  }
}

export async function askAgent(
  messages: AgentChatMessage[],
  signal?: AbortSignal,
): Promise<AgentTurn> {
  let response: Response
  try {
    response = await fetch(AGENT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ messages, system: SYSTEM_PROMPT }),
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new Error(explain(0, 'network'))
  }

  let payload: Record<string, unknown> = {}
  try {
    payload = (await response.json()) as Record<string, unknown>
  } catch {
    throw new Error(explain(response.status, 'unparsable'))
  }

  if (!response.ok) {
    throw new Error(explain(response.status, String(payload.error ?? 'unknown')))
  }

  return {
    model: String(payload.model ?? ''),
    stopReason: String(payload.stopReason ?? 'end_turn'),
    text: String(payload.text ?? ''),
    thinking: payload.thinking ? String(payload.thinking) : null,
    toolCalls: Array.isArray(payload.toolCalls)
      ? (payload.toolCalls as AgentToolCall[])
      : [],
  }
}