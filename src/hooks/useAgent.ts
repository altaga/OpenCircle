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

let seq = 0
const nextId = () => `m${++seq}`

/** Compact a tool payload into one line the model can read without noise. */
function summarise(name: string, result: { ok: true; data: Record<string, unknown> } | { ok: false; error: string }): string {
  if (!result.ok) return `error: ${result.error}`
  const d = result.data
  if (name === 'get_usdc_balance') return `${d.balance} ${d.symbol} on ${d.chain}`
  if (name === 'get_wallet_info') return `${d.address} on ${d.chain}`
  return JSON.stringify(d)
}

export function useAgent(toolCtx: ToolContext | null) {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

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
            const outcome = await runAgentTool(call.name, call.input, toolCtx)
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
    setMessages([])
    setError(null)
    setBusy(false)
  }, [])

  return { messages, busy, error, send, stop, reset }
}