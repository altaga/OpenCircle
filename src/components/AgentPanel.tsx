/**
 * AgentPanel — chat surface for the wallet agent.
 *
 * Shows its work. Tool calls are listed with their real results and thinking is
 * available behind a toggle, because an assistant that quietly reports a balance
 * you cannot audit is worse than no assistant at all.
 *
 * Write tools render a proposal card that the user must Confirm or Cancel
 * before the tool actually runs. The passkey prompt is the *second* gate
 * (fires from inside the tool); this card is the *first* gate, in chat, where
 * the model cannot bypass it.
 */
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bot, Send, Trash2, Wrench, Brain, AlertCircle, Loader2, Info, ShieldCheck } from 'lucide-react'
import type { AgentMessage, PendingProposal } from '@/hooks/useAgent'

interface Props {
  messages: AgentMessage[]
  busy: boolean
  error: string | null
  pendingProposals: PendingProposal[]
  onSend: (text: string) => void
  onStop: () => void
  onReset: () => void
  /**
   * Returns a promise when the tool actually runs (the WebAuthn prompt and
   * the on-chain wait), so the card can disable its buttons until it settles.
   * Typed as `unknown`-returning via `void | Promise<unknown>` rather than
   * `Promise<void>` because `confirmProposal` resolves with a `ToolResult`.
   */
  onConfirmProposal: (id: string) => unknown
  onCancelProposal: (id: string) => void
}

function ProposalCard({
  proposal,
  onConfirm,
  onCancel,
}: {
  proposal: PendingProposal
  /** May be sync (void) or async (Promise<unknown>); the card awaits if so. */
  onConfirm: () => unknown
  onCancel: () => void
}) {
  const [submitting, setSubmitting] = useState(false)
  // Local "I'm confirming" state so the buttons disable while the agent loop
  // is awaiting the tool's actual result. Cancelling is instant.
  // `Promise.resolve` normalises the sync/async union so the `finally` always
  // runs — a sync `onConfirm` must still reset `submitting`.
  const handleConfirm = () => {
    setSubmitting(true)
    return Promise.resolve(onConfirm()).finally(() => setSubmitting(false))
  }

  // Pretty-print the args so the user can audit the address and amount
  // before tapping Confirm. Each write tool renders a small table of its
  // own args; the fallback (raw JSON) covers anything new without a
  // dedicated branch.
  const a = (proposal.args ?? {}) as Record<string, unknown>
  const to = typeof a.to === 'string' ? a.to : ''
  const amount = typeof a.amount === 'string' ? a.amount : ''
  const tokenIn = typeof a.tokenIn === 'string' ? a.tokenIn : ''
  const amountIn = typeof a.amountIn === 'string' ? a.amountIn : ''
  const fromChain = typeof a.fromChain === 'string' ? a.fromChain : ''
  const toChain = typeof a.toChain === 'string' ? a.toChain : ''
  const prettyChain = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—')

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.18 }}
      role="dialog"
      aria-labelledby={`proposal-${proposal.id}-title`}
      className="rounded-2xl p-3.5"
      style={{
        background: 'rgba(255,243,224,0.82)',
        backdropFilter: 'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border: '1px solid rgba(255,205,131,0.42)',
        boxShadow: '0 8px 32px rgba(143,86,18,0.10)',
      }}
    >
      <div className="flex items-start gap-2.5">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
          style={{ background: 'rgba(122,74,0,0.12)' }}
        >
          <ShieldCheck size={15} style={{ color: '#7a4a00' }} />
        </div>
        <div className="min-w-0 flex-1">
          <p
            id={`proposal-${proposal.id}-title`}
            className="text-xs font-bold"
            style={{ color: '#7a4a00' }}
          >
            Agent wants to: {proposal.summary}
          </p>
          {proposal.tool === 'send_usdc' && (
            <dl className="mt-1.5 space-y-0.5 text-xs" style={{ color: '#8a5a14' }}>
              <div className="flex gap-1.5">
                <dt className="shrink-0 font-semibold">To</dt>
                <dd className="break-all font-mono text-[10.5px]">{to || '—'}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="shrink-0 font-semibold">Amount</dt>
                <dd className="tabular-nums">{amount || '—'} USDC</dd>
              </div>
            </dl>
          )}
          {proposal.tool === 'swap_tokens' && (
            <dl className="mt-1.5 space-y-0.5 text-xs" style={{ color: '#8a5a14' }}>
              <div className="flex gap-1.5">
                <dt className="shrink-0 font-semibold">From</dt>
                <dd className="tabular-nums">{amountIn || '—'} {tokenIn || 'token'}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="shrink-0 font-semibold">To</dt>
                <dd>USDC</dd>
              </div>
            </dl>
          )}
          {proposal.tool === 'bridge_usdc' && (
            <dl className="mt-1.5 space-y-0.5 text-xs" style={{ color: '#8a5a14' }}>
              <div className="flex gap-1.5">
                <dt className="shrink-0 font-semibold">From</dt>
                <dd>{prettyChain(fromChain)}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="shrink-0 font-semibold">To</dt>
                <dd>{prettyChain(toChain)}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="shrink-0 font-semibold">Amount</dt>
                <dd className="tabular-nums">{amount || '—'} USDC</dd>
              </div>
            </dl>
          )}
          <p className="mt-1.5 text-[11px] leading-relaxed" style={{ color: '#8a5a14' }}>
            Tap Confirm to continue. Your passkey will be asked for next.
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={onCancel}
          disabled={submitting}
          className="flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
          style={{
            background: 'rgba(255,255,255,0.7)',
            border: '1px solid rgba(138,90,20,0.18)',
            color: '#7a4a00',
          }}
        >
          Cancel
        </button>
        <button
          // `void` is explicit: the promise is handled inside handleConfirm
          // (it owns the `submitting` lifecycle), React just needs fire-and-forget.
          onClick={() => void handleConfirm()}
          disabled={submitting}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-white transition-all active:scale-95 disabled:opacity-60"
          style={{ background: '#7a4a00' }}
        >
          {submitting ? (
            <>
              <Loader2 size={12} className="animate-spin" /> Running…
            </>
          ) : (
            'Confirm'
          )}
        </button>
      </div>
    </motion.div>
  )
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

export function AgentPanel({
  messages,
  busy,
  error,
  pendingProposals,
  onSend,
  onStop,
  onReset,
  onConfirmProposal,
  onCancelProposal,
}: Props) {
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
          Reads your wallet with live Circle data. Sends trigger a confirmation card and then your passkey.
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
              <li>· Send 5 USDC to 0x…</li>
              <li>· Swap 10 USDT to USDC</li>
              <li>· Bridge 10 USDC from Arc to Base</li>
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

        <AnimatePresence>
          {pendingProposals.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              onConfirm={() => void onConfirmProposal(p.id)}
              onCancel={() => onCancelProposal(p.id)}
            />
          ))}
        </AnimatePresence>

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