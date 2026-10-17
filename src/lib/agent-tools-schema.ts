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

const CATALOG = [
  {
    name: 'get_usdc_balance',
    description:
      "Read this wallet's USDC balance on Arc Mainnet. Read-only; it never moves funds. " +
      'Use this whenever the user asks how much they hold, what is in the wallet, or ' +
      'before any amount is mentioned. Report the figure exactly as returned.',
  },
  {
    name: 'get_wallet_info',
    description:
      "Get this wallet's address and the network it lives on. Read-only. Use this when " +
      'the user asks for the address, asks which chain or network this is, or is about to ' +
      'send funds somewhere.',
  },
] as const

export const AGENT_TOOLS: readonly OpenAiToolSpec[] = CATALOG.map((t) => ({
  type: 'function' as const,
  function: { name: t.name, description: t.description, parameters: NO_ARGS },
}))

export const AGENT_TOOLS_ANTHROPIC: readonly AnthropicToolSpec[] = CATALOG.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: NO_ARGS,
}))

export const AGENT_TOOL_NAMES: readonly string[] = CATALOG.map((t) => t.name)