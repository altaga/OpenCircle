/**
 * useAgent — the tool-calling loop, run entirely in the browser.
 *
 * The split matters: the server only proposes, this hook executes. Tool
 * results come back here, where the Circle client key and the passkey live, and
 * that data is never sent to the model except as a tool result it asked for.
 *
 * The round budget is not a formality. An agent that can call tools can loop —
 * each round costs real tokens — so the loop is hard-capped and the model is
 * told what came back even when the budget runs out.
 */

import { useCallback, useRef, useState } from 'react'
import { askAgent, type AgentChatMessage } from '@/lib/agent-client'
import { runAgentTool, type ToolContext } from '@/lib/agent-tools'
import { WRITE_TOOL_NAMES } from '@/lib/agent-tools-schema'

/** Hard cap on model round-trips per user message. */
const MAX_ROUNDS = 4

export interface ToolTrace {
  name: string
  ok: boolean
  summary: string
}

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  thinking?: string | null
  tools?: ToolTrace[]
  failed?: boolean
}

/**
 * A write-tool proposal that has been queued by the agent loop and is waiting
 * for the user to click Confirm / Cancel in the chat UI. The `resolve` lives
 * in a ref (not state) because it is a function and React state cannot hold
 * one across renders. The proposal metadata below is duplicated in state so
 * the panel can render cards without the resolver.
 */
export interface PendingProposal {
  id: string
  tool: string
  args: unknown
  /** Human-readable one-liner, e.g. "Send 10 USDC to 0xABCD…". */
  summary: string
}

let seq = 0
const nextId = () => `m${++seq}`
const nextProposalId = () => `p${++seq}`

/**
 * Render a write tool's args into a one-line summary the user can read before
 * tapping Confirm. Truncates addresses so the card stays narrow; the full
 * address is in `args` for the panel to display on demand.
 */
function summariseProposal(name: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>
  const to = typeof a.to === 'string' ? a.to : ''
  const amount = typeof a.amount === 'string' ? a.amount : ''
  if (name === 'send_usdc') {
    const short = to ? `${to.slice(0, 8)}…${to.slice(-6)}` : 'unknown address'
    return `Send ${amount || '?'} USDC to ${short}`
  }
  if (name === 'swap_tokens') {
    const tokenIn = typeof a.tokenIn === 'string' ? a.tokenIn : '?'
    const amountIn = typeof a.amountIn === 'string' ? a.amountIn : '?'
    return `Swap ${amountIn} ${tokenIn} → USDC`
  }
  if (name === 'bridge_usdc') {
    const from = typeof a.fromChain === 'string' ? a.fromChain : '?'
    const toChain = typeof a.toChain === 'string' ? a.toChain : '?'
    const amt = typeof a.amount === 'string' ? a.amount : '?'
    const pretty = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
    return `Bridge ${amt} USDC from ${pretty(from)} to ${pretty(toChain)}`
  }
  return `${name}(${JSON.stringify(args)})`
}

/**
 * Read a scalar out of an untrusted tool payload. `Record<string, unknown>`
 * makes every field `unknown`, and template-stringing one of those renders
 * `[object Object]` for a structured value — a lie that reads like data. This
 * returns the fallback instead of pretending.
 */
function str(v: unknown, fallback = '?'): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  return fallback
}

/** Compact a tool payload into one line the model can read without noise. */
function summarise(name: string, result: { ok: true; data: Record<string, unknown> } | { ok: false; error: string }): string {
  if (!result.ok) return `error: ${result.error}`
  const d = result.data
  if (name === 'get_usdc_balance') return `${str(d.balance)} ${str(d.symbol)} on ${str(d.chain)}`
  if (name === 'get_wallet_info') return `${str(d.address)} on ${str(d.chain)}`
  if (name === 'send_usdc') return `sent ${str(d.amount)} USDC to ${str(d.to).slice(0, 8)}… · tx ${str(d.txHash, '').slice(0, 10)}…`
  if (name === 'swap_tokens') {
    const out = d.estimatedOutput as { amount?: string; token?: string } | null
    const outStr = out?.amount ? `≈ ${out.amount} ${out.token ?? 'USDC'}` : 'completed'
    return `swapped ${str(d.amountIn)} ${str(d.tokenIn)} to USDC · ${outStr} · tx ${str(d.txHash, '').slice(0, 10)}…`
  }
  if (name === 'bridge_usdc') {
    const steps = (Array.isArray(d.steps) ? d.steps : []).filter(
      (s): s is { state: string } => typeof s === 'object' && s !== null && typeof (s as { state?: unknown }).state === 'string',
    )
    const done = steps.filter((s) => s.state === 'success').length
    return `bridged ${str(d.amount)} USDC from ${str(d.fromChain)} to ${str(d.toChain)} · ${done}/${steps.length} steps · state=${str(d.bridgeState)} · tx ${str(d.txHash, '').slice(0, 10)}…`
  }
  return JSON.stringify(d)
}

export function useAgent(toolCtx: ToolContext | null) {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingProposals, setPendingProposals] = useState<PendingProposal[]>([])
  const abortRef = useRef<AbortController | null>(null)
  // Resolvers cannot live in state; one Map per hook instance, cleared on reset.
  const proposalResolvers = useRef(new Map<string, (r: { ok: true; data: Record<string, unknown> } | { ok: false; error: string }) => void>())

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || busy) return
      if (!toolCtx) {
        setError('Connect the wallet before using the agent.')
        return
      }

      const userMsg: AgentMessage = { id: nextId(), role: 'user', text: trimmed }
      setMessages((prev) => [...prev, userMsg])
      setBusy(true)
      setError(null)

      const controller = new AbortController()
      abortRef.current = controller

      // Transcript for the model. Seeded from history so it can refer back.
      const turns: AgentChatMessage[] = [
        { role: 'user', content: trimmed },
      ]

      const trace: ToolTrace[] = []
      let thinking: string | null = null
      let answer = ''

      try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const turn = await askAgent(turns, controller.signal)
          thinking = turn.thinking ?? thinking

          if (turn.toolCalls.length === 0) {
            answer = turn.text
            break
          }

          const results: string[] = []
          for (const call of turn.toolCalls) {
            let outcome: { ok: true; data: Record<string, unknown> } | { ok: false; error: string }
            if (WRITE_TOOL_NAMES.includes(call.name)) {
              // Write tools gate on a proposal. We register the proposal, then
              // suspend this turn until the user clicks Confirm (which runs the
              // tool and triggers WebAuthn) or Cancel (which resolves with a
              // user_cancelled error). The agent loop is awaiting, so a
              // slow click is fine — but a model that proposes while a card is
              // already up would queue a second card. That is acceptable: the
              // panel renders both, the user can decide each.
              outcome = await new Promise((resolve) => {
                const id = nextProposalId()
                proposalResolvers.current.set(id, resolve)
                setPendingProposals((prev) => [
                  ...prev,
                  { id, tool: call.name, args: call.input, summary: summariseProposal(call.name, call.input) },
                ])
              })
            } else {
              outcome = await runAgentTool(call.name, call.input, toolCtx)
            }
            trace.push({ name: call.name, ok: outcome.ok, summary: summarise(call.name, outcome) })
            results.push(
              outcome.ok
                ? `Tool ${call.name} returned: ${JSON.stringify(outcome.data)}`
                : `Tool ${call.name} failed: ${outcome.error}`,
            )
          }

          turns.push({
            role: 'assistant',
            content: `[called tools: ${turn.toolCalls.map((c) => c.name).join(', ')}]`,
          })
          turns.push({ role: 'user', content: results.join('\n') })

          if (round === MAX_ROUNDS - 1) {
            answer = 'I reached my step limit for this request. Try asking one thing at a time.'
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', text: 'Cancelled.', failed: true }])
        } else {
          const reason = err instanceof Error ? err.message : String(err)
          setError(reason)
          setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', text: reason, failed: true }])
        }
      } finally {
        abortRef.current = null
        setBusy(false)
      }

      if (answer) {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'assistant', text: answer, thinking, tools: trace },
        ])
      }
    },
    [busy, toolCtx],
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    // Reject any in-flight proposals so the agent loop unblocks if a send()
    // is awaiting on one. Otherwise the Promise sits unresolved forever and
    // the next send() would race against a stale resolver.
    for (const resolve of proposalResolvers.current.values()) {
      resolve({ ok: false, error: 'reset' })
    }
    proposalResolvers.current.clear()
    setPendingProposals([])
    setMessages([])
    setError(null)
    setBusy(false)
  }, [])

  /**
   * User clicked Confirm on a proposal card. Run the tool for real (which
   * triggers WebAuthn via `toolCtx.sendUsdc`) and resolve the agent loop.
   * Errors are translated into a `ToolResult` so the model can speak to the
   * user; they do not throw out of the hook.
   */
  const confirmProposal = useCallback(
    async (id: string) => {
      const resolve = proposalResolvers.current.get(id)
      if (!resolve || !toolCtx) return
      proposalResolvers.current.delete(id)
      const proposal = pendingProposals.find((p) => p.id === id)
      setPendingProposals((prev) => prev.filter((p) => p.id !== id))
      // `runAgentTool` does its own validation, so the worst the model can
      // do via stale state is land in `invalid_*` — the user has already
      // tapped Confirm and we report back honestly.
      const outcome = await runAgentTool(proposal?.tool ?? '', proposal?.args, toolCtx)
      resolve(outcome)
    },
    [pendingProposals, toolCtx],
  )

  /**
   * User clicked Cancel on a proposal card. The tool never runs; the agent
   * loop gets a `user_cancelled` error and explains that to the user.
   */
  const cancelProposal = useCallback((id: string) => {
    const resolve = proposalResolvers.current.get(id)
    if (!resolve) return
    proposalResolvers.current.delete(id)
    setPendingProposals((prev) => prev.filter((p) => p.id !== id))
    resolve({ ok: false, error: 'user_cancelled' })
  }, [])

  return { messages, busy, error, send, stop, reset, pendingProposals, confirmProposal, cancelProposal }
}