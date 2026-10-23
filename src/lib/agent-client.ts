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
  'You have read tools (`get_usdc_balance`, `get_wallet_info`) and three write tools ' +
  '(`send_usdc` to send USDC, `swap_tokens` to convert a supported token into USDC, ' +
  '`bridge_usdc` to move USDC across chains via CCTP). ' +
  'Before any write tool call, call `get_usdc_balance` (or `get_wallet_info`) first to ' +
  'confirm the network and that the user has the funds they want to move. All amounts ' +
  'are in display units (e.g. "10.50"), not raw base units. ' +
  'For `swap_tokens`, only USDT, EURC, DAI and WETH are accepted as sources. ' +
  'For `bridge_usdc`, supported chains are arc, base and arbitrum; source and ' +
  'destination must differ. ' +
  'Before calling any write tool, briefly summarise in plain language what you are ' +
  'about to do ("I want to send 10 USDC to 0x…", "I want to swap 10 USDT to USDC", ' +
  '"I want to bridge 10 USDC from Arc to Base"). The user will then see a confirmation ' +
  'card and must tap Confirm before any funds move. The passkey prompt is the second ' +
  'gate and fires from inside the tool. ' +
  'Report balances and addresses exactly as the tools return them — never round, convert ' +
  'or guess. If a tool fails or the user cancels, say what happened instead of inventing ' +
  'an answer. Do not chain write tools with other tools in a single round; one ' +
  'proposal at a time.'

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