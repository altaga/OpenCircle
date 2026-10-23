/**
 * Agent tool schemas — shared by the browser runner and the server proxy.
 *
 * Dependency-free on purpose: `netlify/functions/agent.ts` imports this through
 * esbuild, and pulling viem or the Circle SDK in would ship megabytes to a
 * function that only needs to describe tools. Execution lives in
 * `src/lib/agent-tools.ts`; this file is only the contract.
 *
 * The server treats these as the authoritative catalog. The browser cannot add
 * tools to a request, because a tool definition arriving from the client is
 * just an attacker telling the model what to call.
 */

export interface ToolParameterSchema {
  type: 'object'
  properties: Record<string, unknown>
  required: string[]
}

/** OpenAI-compatible shape, used by the client runner and for documentation. */
export interface OpenAiToolSpec {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: ToolParameterSchema
  }
}

/** Anthropic-compatible shape, what the proxy actually sends. */
export interface AnthropicToolSpec {
  name: string
  description: string
  input_schema: ToolParameterSchema
}

const NO_ARGS: ToolParameterSchema = { type: 'object', properties: {}, required: [] }

const SEND_USDC_PARAMS: ToolParameterSchema = {
  type: 'object',
  properties: {
    to: {
      type: 'string',
      description: 'Recipient address, 0x-prefixed 20-byte EVM hex (40 chars after 0x).',
    },
    amount: {
      type: 'string',
      description: 'USDC amount in display units (e.g. "10.50"), not raw base units.',
    },
  },
  required: ['to', 'amount'],
}

const SWAP_TOKENS_PARAMS: ToolParameterSchema = {
  type: 'object',
  properties: {
    tokenIn: {
      type: 'string',
      enum: ['USDT', 'EURC', 'DAI', 'WETH'],
      description: 'Source token to swap from. Only tokens supported on Arc Mainnet are accepted.',
    },
    amountIn: {
      type: 'string',
      description: 'Source amount in display units (e.g. "10.50"), not raw base units.',
    },
  },
  required: ['tokenIn', 'amountIn'],
}

const BRIDGE_USDC_PARAMS: ToolParameterSchema = {
  type: 'object',
  properties: {
    fromChain: {
      type: 'string',
      enum: ['arc', 'base', 'arbitrum'],
      description: 'Source chain for the bridge. The wallet must be connected on this chain at execution time.',
    },
    toChain: {
      type: 'string',
      enum: ['arc', 'base', 'arbitrum'],
      description: 'Destination chain for the bridge. Must differ from fromChain.',
    },
    amount: {
      type: 'string',
      description: 'USDC amount in display units (e.g. "10.50"), not raw base units.',
    },
  },
  required: ['fromChain', 'toChain', 'amount'],
}

interface CatalogEntry {
  name: string
  description: string
  parameters: ToolParameterSchema
}

const CATALOG: readonly CatalogEntry[] = [
  {
    name: 'get_usdc_balance',
    description:
      "Read this wallet's USDC balance on Arc Mainnet. Read-only; it never moves funds. " +
      'Use this whenever the user asks how much they hold, what is in the wallet, or ' +
      'before any amount is mentioned. Report the figure exactly as returned.',
    parameters: NO_ARGS,
  },
  {
    name: 'get_wallet_info',
    description:
      "Get this wallet's address and the network it lives on. Read-only. Use this when " +
      'the user asks for the address, asks which chain or network this is, or is about to ' +
      'send funds somewhere.',
    parameters: NO_ARGS,
  },
  {
    name: 'send_usdc',
    description:
      "Send USDC from this wallet to a single recipient on Arc Mainnet. " +
      "Always call `get_usdc_balance` first to confirm the sender has enough, and " +
      "`get_wallet_info` to confirm the network and the sender's own address. " +
      'The amount is in display units (e.g. "10.50"), not raw base units. ' +
      'A successful call returns the transaction hash. ' +
      'IMPORTANT: this tool always triggers an in-chat confirmation card AND a ' +
      'WebAuthn (passkey) prompt before any funds move. Surface a one-line summary ' +
      '("I want to send X USDC to 0x… — please confirm") so the user can read it ' +
      'before the proposal card appears. Do not chain `send_usdc` with other tools ' +
      'in a single round; one proposal at a time.',
    parameters: SEND_USDC_PARAMS,
  },
  {
    name: 'swap_tokens',
    description:
      "Swap a supported token into USDC on Arc Mainnet via Circle App Kit. " +
      "Supported sources: USDT, EURC, DAI, WETH. " +
      "The amount is in display units (e.g. \"10.50\") of the source token. " +
      "Use `get_wallet_info` first to confirm the network. " +
      "IMPORTANT: this tool always triggers an in-chat confirmation card AND a " +
      "WebAuthn (passkey) prompt before any funds move. Before calling it, " +
      "summarise in plain language what you are about to do " +
      "(\"I want to swap 10 USDT to USDC — please confirm\"). The user sees the " +
      "card and must tap Confirm before the wallet prompts for signing. " +
      "Do not chain `swap_tokens` with other tools in a single round; one " +
      "proposal at a time. If the user only has the destination token, this " +
      "tool is not the right one — point them to the Send tab.",
    parameters: SWAP_TOKENS_PARAMS,
  },
  {
    name: 'bridge_usdc',
    description:
      "Bridge USDC across chains via Circle App Kit + CCTP. " +
      "Supported chains: arc, base, arbitrum. Source and destination must differ. " +
      "The amount is in display units (e.g. \"10.50\") of USDC. " +
      "Use `get_wallet_info` first to confirm the wallet exists on the source " +
      "chain — bridging FROM a chain the wallet does not hold USDC on will " +
      "fail at the burn step. " +
      "IMPORTANT: this tool always triggers an in-chat confirmation card AND a " +
      "WebAuthn (passkey) prompt before any funds move. Before calling it, " +
      "summarise in plain language what you are about to do " +
      "(\"I want to bridge 10 USDC from Arc to Base — please confirm\"). " +
      "Do not chain `bridge_usdc` with other tools in a single round; one " +
      "proposal at a time. Bridges are not instant — the CCTP attestation " +
      "step can take a few minutes.",
    parameters: BRIDGE_USDC_PARAMS,
  },
] as const

export const AGENT_TOOLS: readonly OpenAiToolSpec[] = CATALOG.map((t) => ({
  type: 'function' as const,
  function: { name: t.name, description: t.description, parameters: t.parameters },
}))

export const AGENT_TOOLS_ANTHROPIC: readonly AnthropicToolSpec[] = CATALOG.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.parameters,
}))

export const AGENT_TOOL_NAMES: readonly string[] = CATALOG.map((t) => t.name)

/** Tools that require an in-chat confirmation card before they execute. */
export const WRITE_TOOL_NAMES: readonly string[] = CATALOG.filter(
  (t) => t.name !== 'get_usdc_balance' && t.name !== 'get_wallet_info',
).map((t) => t.name)