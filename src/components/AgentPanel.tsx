/**
 * AgentPanel — chat surface for the wallet agent.
 *
 * Shows its work. Tool calls are listed with their real results and thinking is
 * available behind a toggle, because an assistant that quietly reports a balance
 * you cannot audit is worse than no assistant at all.
 *
 * The agent cannot move funds. Copy says so where the user will see it, rather
 * than leaving them to discover it.
 */
import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Bot, Send, Trash2, Wrench, Brain, AlertCircle, Loader2, Info } from 'lucide-react'
import type { AgentMessage } from '@/hooks/useAgent'

interface Props {
  messages: AgentMessage[]
  busy: boolean
  error: string | null
  onSend: (text: string) => void
  onStop: () => void
  onReset: () => void
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium transition-opacity hover:opacity-70"
        style={{ color: '#8a849c' }}
      >
        <Brain size={12} />
        {open ? 'Hide reasoning' : 'Show reasoning'}
      </button>
      {open && (
        <p
          className="mt-1.5 whitespace-pre-wrap rounded-xl p-2.5 text-xs leading-relaxed"
          style={{ background: 'rgba(18,45,69,0.05)', color: '#6b6580' }}
        >
          {text}
        </p>
      )}
    </div>
  )
}

export function AgentPanel({ messages, busy, error, onSend, onStop, onReset }: Props) {
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, busy])

  const submit = () => {
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    onSend(text)
  }

  return (
    <div className="flex h-[calc(100dvh-13rem)] flex-col">
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-xs leading-relaxed" style={{ color: '#6b6580' }}>
          Reads your wallet with live Circle data. It cannot send, swap or bridge — those need your passkey.
        </p>
        {messages.length > 0 && (
          <button
            onClick={onReset}
            aria-label="Clear conversation"
            className="shrink-0 rounded-lg p-1.5 transition-opacity hover:opacity-60"
            style={{ color: '#8a849c' }}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.length === 0 && (
          <div
            className="rounded-2xl p-4 text-sm"
            style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.7)' }}
          >
            <p className="font-semibold" style={{ color: '#122d45' }}>Try asking</p>
            <ul className="mt-2 space-y-1.5 text-xs" style={{ color: '#6b6580' }}>
              <li>· How much USDC do I have?</li>
              <li>· What is my wallet address?</li>
              <li>· Which network am I on?</li>
            </ul>
          </div>
        )}

        {messages.map((m) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={m.role === 'user' ? 'flex justify-end' : ''}
          >
            <div
              className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm"
              style={
                m.role === 'user'
                  ? { background: '#122d45', color: '#fff' }
                  : m.failed
                    ? { background: 'rgba(186,43,76,0.08)', color: '#ba2b4c', border: '1px solid rgba(186,43,76,0.16)' }
                    : { background: 'rgba(255,255,255,0.72)', color: '#122d45', border: '1px solid rgba(255,255,255,0.72)' }
              }
            >
              {m.role === 'assistant' && !m.failed && (
                <Bot size={13} className="mb-1.5" style={{ color: '#8a849c' }} />
              )}
              <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>

              {m.tools && m.tools.length > 0 && (
                <div className="mt-2 space-y-1">
                  {m.tools.map((t, i) => (
                    <div
                      key={`${m.id}-t${i}`}
                      className="flex items-start gap-1.5 rounded-lg px-2 py-1 text-xs"
                      style={{ background: 'rgba(18,45,69,0.05)', color: '#6b6580' }}
                    >
                      <Wrench size={11} className="mt-0.5 shrink-0" />
                      <span className="min-w-0">
                        <span className="font-semibold">{t.name}</span>
                        {' · '}
                        {t.summary}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {m.thinking && <Thinking text={m.thinking} />}
            </div>
          </motion.div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-xs" style={{ color: '#8a849c' }}>
            <Loader2 size={13} className="animate-spin" />
            Thinking…
          </div>
        )}

        {error && !busy && (
          <div
            className="flex items-start gap-2 rounded-2xl p-3 text-xs"
            style={{ background: 'rgba(186,43,76,0.08)', color: '#ba2b4c', border: '1px solid rgba(186,43,76,0.16)' }}
          >
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div ref={endRef} />
      </div>

      <div className="mt-3">
        <div
          className="flex items-end gap-2 rounded-2xl p-2"
          style={{ background: 'rgba(255,255,255,0.66)', border: '1px solid rgba(255,255,255,0.7)' }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            rows={1}
            placeholder="Ask about your wallet…"
            className="max-h-28 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2.5 text-sm outline-none"
            style={{ color: '#122d45' }}
          />
          {busy ? (
            <button
              onClick={onStop}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white transition-all active:scale-95"
              style={{ background: '#8a849c' }}
              aria-label="Stop"
            >
              <Info size={15} />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!draft.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white transition-all active:scale-95 disabled:opacity-35"
              style={{ background: '#122d45' }}
              aria-label="Send"
            >
              <Send size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}