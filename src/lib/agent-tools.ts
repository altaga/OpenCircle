/**
 * Agent tools — the operations the model is allowed to ask for.
 *
 * v1 is deliberately read-only. Every tool here answers a question about the
 * wallet and moves nothing. That is not timidity about the model: the signing
 * key is device-bound, so a model *cannot* move funds even if a tool could. The
 * read-only limit exists because a mutation tool would still be a tool that runs
 * without a human reading it, and that is where the real mistakes live — a
 * hallucinated amount, a wrong address parsed from a truncated string.
 *
 * Adding a writing tool later means: name it, describe its blast radius, show
 * the exact parameters, and require the passkey. The gate is the authenticator,
 * not this file.
 */

import { createPublicClient, erc20Abi, formatUnits, type Hex } from 'viem'
import { arc } from 'viem/chains'
import { toModularTransport } from '@circle-fin/modular-wallets-core'
import { CIRCLE_RPC_URL } from '@/lib/circle-config'

export interface ToolContext {
  address: Hex
  clientKey: string
  chainPath: string
  usdcContractAddress: Hex
}

export type ToolResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string }

interface ToolSpec {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] }
  }
}

const NO_ARGS = { type: 'object' as const, properties: {}, required: [] }

/** OpenAI-compatible tool schemas. Kept literal so they can be diffed. */
export const AGENT_TOOLS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'get_usdc_balance',
      description:
        "Read this wallet's USDC balance on Arc Mainnet. Read-only; it never moves funds. " +
        'Use this whenever the user asks how much they hold, what is in the wallet, or before ' +
        'any amount is mentioned.',
      parameters: NO_ARGS,
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_wallet_info',
      description:
        'Get this wallet\'s address and the network it lives on. Read-only. ' +
        'Use this when the user asks for the address, wants to send funds somewhere, or ' +
        'asks which chain or network this is.',
      parameters: NO_ARGS,
    },
  },
]

function client(ctx: ToolContext) {
  return createPublicClient({
    chain: arc,
    transport: toModularTransport(`${CIRCLE_RPC_URL}${ctx.chainPath}`, ctx.clientKey),
  })
}

const USDC_DECIMALS = 6

/** Run a tool by name. Unknown names fail closed rather than guessing. */
export async function runAgentTool(
  name: string,
  _args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.address || ctx.address === '0x') {
    return { ok: false, error: 'wallet_not_connected' }
  }

  try {
    switch (name) {
      case 'get_usdc_balance': {
        const raw = await client(ctx).readContract({
          address: ctx.usdcContractAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [ctx.address],
        })
        return {
          ok: true,
          data: {
            balance: formatUnits(raw, USDC_DECIMALS),
            symbol: 'USDC',
            decimals: USDC_DECIMALS,
            chain: 'Arc Mainnet',
            chainId: arc.id,
          },
        }
      }

      case 'get_wallet_info':
        return {
          ok: true,
          data: {
            address: ctx.address,
            chain: 'Arc Mainnet',
            chainId: arc.id,
            explorer: `https://explorer.arc.io/address/${ctx.address}`,
            type: 'Modular Smart Contract Account (ERC-4337)',
            custodian: 'self — passkey on this device, no seed phrase',
          },
        }

      default:
        return { ok: false, error: `unknown_tool:${name}` }
    }
  } catch (err) {
    // Tool errors go back to the model as data, so it can explain rather than
    // retry blindly. No stack, no key.
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `tool_failed:${message.slice(0, 160)}` }
  }
}