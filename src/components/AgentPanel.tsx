/**
 * AgentPanel — high-end Swiss minimalist chat surface for OpenCircle.
 *
 * Implements strict accessibility, interactive prompt suggestions,
 * non-disruptive tool execution badges, collapsible reasoning drawers,
 * and gated write-proposals (Intent check Gate 1).
 */
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bot,
  ArrowUp,
  Square,
  RotateCcw,
  Sparkles,
  ShieldCheck,
  Brain,
  AlertCircle,
  Loader2,
  ArrowRight,
} from 'lucide-react'
import type { AgentMessage, PendingProposal } from '@/hooks/useAgent'

interface Props {
  messages: AgentMessage[]
  busy: boolean
  error: string | null
  pendingProposals: PendingProposal[]
  onSend: (text: string) => void
  onStop: () => void
  onReset: () => void
  onConfirmProposal: (id: string) => unknown
  onCancelProposal: (id: string) => void
}

const QUICK_PROMPTS = [
  { label: 'Check USDC balance', prompt: 'How much USDC do I have?' },
  { label: 'Wallet address', prompt: 'What is my wallet address and explorer link?' },
  { label: 'Send 5 USDC', prompt: 'I want to send 5 USDC to 0x' },
  { label: 'Swap USDT to USDC', prompt: 'I want to swap 10 USDT to USDC' },
  { label: 'Bridge USDC to Base', prompt: 'I want to bridge 10 USDC from Arc to Base' },
]

function ProposalCard({
  proposal,
  onConfirm,
  onCancel,
}: {
  proposal: PendingProposal
  onConfirm: () => unknown
  onCancel: () => void
}) {
  const [submitting, setSubmitting] = useState(false)

  const handleConfirm = () => {
    setSubmitting(true)
    return Promise.resolve(onConfirm()).finally(() => setSubmitting(false))
  }

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
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      role="dialog"
      aria-labelledby={`proposal-${proposal.id}-title`}
      className="my-2 rounded-2xl p-4 shadow-sm"
      style={{
        background: 'linear-gradient(180deg, rgba(255,251,245,0.96) 0%, rgba(255,246,235,0.92) 100%)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(224,160,60,0.35)',
        boxShadow: '0 8px 28px rgba(180,100,10,0.08)',
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
          style={{ background: 'rgba(190,110,20,0.12)' }}
        >
          <ShieldCheck size={16} style={{ color: '#965a08' }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#965a08]">
              Gate 1 · Intent Authorization
            </span>
          </div>
          <h4
            id={`proposal-${proposal.id}-title`}
            className="mt-0.5 text-xs font-bold leading-snug text-[#4a2e05]"
          >
            {proposal.summary}
          </h4>

          {proposal.tool === 'send_usdc' && (
            <div className="mt-2.5 rounded-xl bg-white/70 p-2.5 text-xs text-[#5c3a09]">
              <div className="flex justify-between py-0.5">
                <span className="text-[11px] text-[#8a6a3b]">Recipient</span>
                <span className="break-all font-mono text-[11px] font-medium text-[#2d1b03]">{to || '—'}</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-[11px] text-[#8a6a3b]">Amount</span>
                <span className="font-semibold tabular-nums text-[#2d1b03]">{amount || '0'} USDC</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-[11px] text-[#8a6a3b]">Network</span>
                <span className="font-medium text-[#2d1b03]">Arc Mainnet</span>
              </div>
            </div>
          )}

          {proposal.tool === 'swap_tokens' && (
            <div className="mt-2.5 rounded-xl bg-white/70 p-2.5 text-xs text-[#5c3a09]">
              <div className="flex justify-between py-0.5">
                <span className="text-[11px] text-[#8a6a3b]">Paying</span>
                <span className="font-semibold tabular-nums text-[#2d1b03]">{amountIn} {tokenIn}</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-[11px] text-[#8a6a3b]">Receiving</span>
                <span className="font-semibold text-[#2d1b03]">USDC</span>
              </div>
            </div>
          )}

          {proposal.tool === 'bridge_usdc' && (
            <div className="mt-2.5 rounded-xl bg-white/70 p-2.5 text-xs text-[#5c3a09]">
              <div className="flex justify-between py-0.5">
                <span className="text-[11px] text-[#8a6a3b]">Route</span>
                <span className="font-medium text-[#2d1b03]">
                  {prettyChain(fromChain)} → {prettyChain(toChain)}
                </span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-[11px] text-[#8a6a3b]">Amount</span>
                <span className="font-semibold tabular-nums text-[#2d1b03]">{amount} USDC</span>
              </div>
            </div>
          )}

          <p className="mt-2 text-[11px] leading-relaxed text-[#8a6a3b]">
            Review carefully. Approving will trigger your passkey for cryptographic signature.
          </p>
        </div>
      </div>

      <div className="mt-3.5 flex gap-2">
        <button
          onClick={onCancel}
          disabled={submitting}
          className="flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
          style={{
            background: 'rgba(255,255,255,0.85)',
            border: '1px solid rgba(190,120,30,0.22)',
            color: '#7a4805',
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => void handleConfirm()}
          disabled={submitting}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white transition-all active:scale-95 disabled:opacity-60 shadow-sm"
          style={{ background: '#8c4e03' }}
        >
          {submitting ? (
            <>
              <Loader2 size={13} className="animate-spin" /> Signing…
            </>
          ) : (
            'Confirm & Sign'
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
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:bg-black/5 hover:text-slate-800"
      >
        <Brain size={12} className="text-purple-600" />
        <span>{open ? 'Hide reasoning' : 'View reasoning'}</span>
        <span className="text-[10px] text-slate-400">({text.length} chars)</span>
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mt-1.5 overflow-hidden rounded-xl border border-purple-100 bg-purple-50/60 p-3 font-mono text-[11px] leading-relaxed text-slate-700 select-text"
        >
          {text}
        </motion.div>
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
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, busy, pendingProposals.length])

  const submit = (overrideText?: string) => {
    const text = (overrideText ?? draft).trim()
    if (!text || busy) return
    setDraft('')
    onSend(text)
  }

  return (
    <div className="flex h-[calc(100dvh-13.5rem)] flex-col justify-between">
      {/* Top micro status bar */}
      <div className="mb-2.5 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-lg bg-[#122d45] text-white">
            <Bot size={12} />
          </div>
          <span className="text-xs font-bold text-[#122d45]">Arc Assistant</span>
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
            MiniMax M3
          </span>
        </div>
        {messages.length > 0 && (
          <button
            onClick={onReset}
            title="Reset conversation"
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 transition-all hover:bg-white/80 hover:text-slate-800 active:scale-95"
          >
            <RotateCcw size={11} />
            Reset
          </button>
        )}
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1 pb-2">
        {messages.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-3xl p-5 shadow-xs"
            style={{
              background: 'rgba(255,255,255,0.80)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(255,255,255,0.85)',
            }}
          >
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-blue-50 text-[#1061a6]">
                <Sparkles size={15} />
              </div>
              <h3 className="text-sm font-bold text-[#122d45]">Welcome to OpenCircle AI</h3>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[#6b6580]">
              Ask questions about your balance, inspect on-chain details, or draft transfers, swaps, and cross-chain bridges. All transactions require your explicit approval and hardware passkey.
            </p>

            <div className="mt-4 pt-3 border-t border-slate-100">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Suggested Actions
              </span>
              <div className="mt-2 space-y-1.5">
                {QUICK_PROMPTS.map(({ label, prompt }) => (
                  <button
                    key={label}
                    onClick={() => submit(prompt)}
                    className="group flex w-full items-center justify-between rounded-xl border border-slate-200/60 bg-white/60 px-3 py-2 text-left text-xs font-medium text-[#122d45] transition-all hover:border-slate-300 hover:bg-white hover:shadow-xs active:scale-[0.98]"
                  >
                    <span>{label}</span>
                    <ArrowRight size={12} className="text-slate-400 opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {messages.map((m) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
          >
            <div
              className={`max-w-[88%] text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'rounded-2xl rounded-br-xs px-4 py-2.5 font-medium text-white shadow-xs'
                  : 'rounded-2xl rounded-tl-xs px-4 py-3 shadow-xs'
              }`}
              style={
                m.role === 'user'
                  ? { background: '#122d45' }
                  : m.failed
                    ? {
                        background: 'rgba(254, 242, 242, 0.95)',
                        color: '#991b1b',
                        border: '1px solid rgba(248, 113, 113, 0.3)',
                      }
                    : {
                        background: 'rgba(255, 255, 255, 0.92)',
                        backdropFilter: 'blur(20px)',
                        color: '#122d45',
                        border: '1px solid rgba(255, 255, 255, 0.85)',
                      }
              }
            >
              {m.role === 'assistant' && !m.failed && (
                <div className="mb-1.5 flex items-center gap-1.5">
                  <div className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-100 text-[#122d45]">
                    <Bot size={10} />
                  </div>
                  <span className="text-[10px] font-bold tracking-tight text-slate-400">Agent</span>
                </div>
              )}

              <p className="whitespace-pre-wrap">{m.text}</p>

              {/* Tool call traces rendered as engineered status badges */}
              {m.tools && m.tools.length > 0 && (
                <div className="mt-2.5 space-y-1">
                  {m.tools.map((t, i) => (
                    <div
                      key={`${m.id}-t${i}`}
                      className="flex items-center gap-2 rounded-lg border border-slate-200/70 bg-white/70 px-2.5 py-1 text-[11px] text-slate-700 shadow-2xs"
                    >
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          t.ok ? 'bg-emerald-500 ring-2 ring-emerald-500/20' : 'bg-rose-500'
                        }`}
                      />
                      <span className="font-mono font-semibold text-[#122d45]">{t.name}</span>
                      <span className="text-slate-300">·</span>
                      <span className="min-w-0 flex-1 truncate text-slate-600">{t.summary}</span>
                    </div>
                  ))}
                </div>
              )}

              {m.thinking && <Thinking text={m.thinking} />}
            </div>
          </motion.div>
        ))}

        {/* Pending Proposals (Intent check cards) */}
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
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 px-1 text-xs text-[#8a849c]"
          >
            <Loader2 size={13} className="animate-spin text-[#122d45]" />
            <span>Assistant is evaluating on-chain state…</span>
          </motion.div>
        )}

        {error && !busy && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50/90 p-3 text-xs text-rose-800"
          >
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-rose-600" />
            <span className="leading-relaxed">{error}</span>
          </motion.div>
        )}

        <div ref={endRef} />
      </div>

      {/* Input container - ALWAYS PINNED AT BOTTOM */}
      <div className="mt-2 shrink-0">
        {/* Quick prompt horizontal chips when conversation is active */}
        {messages.length > 0 && !busy && (
          <div className="mb-2 flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
            {QUICK_PROMPTS.slice(0, 3).map(({ label, prompt }) => (
              <button
                key={label}
                onClick={() => submit(prompt)}
                className="shrink-0 rounded-full border border-slate-200/80 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-2xs transition-all hover:bg-white active:scale-95"
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div
          className="flex items-end gap-2 rounded-2xl p-2 transition-all focus-within:ring-2 focus-within:ring-[#122d45]/20"
          style={{
            background: 'rgba(255, 255, 255, 0.88)',
            backdropFilter: 'blur(28px) saturate(180%)',
            WebkitBackdropFilter: 'blur(28px) saturate(180%)',
            border: '1px solid rgba(255, 255, 255, 0.90)',
            boxShadow: '0 4px 20px rgba(18, 45, 69, 0.08)',
          }}
        >
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            rows={1}
            placeholder="Ask anything or request a transaction…"
            className="max-h-24 min-h-[38px] flex-1 resize-none bg-transparent px-2.5 py-2 text-sm leading-relaxed text-[#122d45] outline-none placeholder:text-slate-400"
          />

          {busy ? (
            <button
              onClick={onStop}
              title="Stop response"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-700 text-white transition-all hover:bg-slate-800 active:scale-95 shadow-sm"
              aria-label="Stop"
            >
              <Square size={13} className="fill-white" />
            </button>
          ) : (
            <button
              onClick={() => submit()}
              disabled={!draft.trim()}
              title="Send message"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#122d45] text-white transition-all hover:bg-[#1a3d5e] active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 shadow-sm"
              aria-label="Send"
            >
              <ArrowUp size={16} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
