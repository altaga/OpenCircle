/**
 * WalletSetup — passkey registration / login screen.
 * Arc Light consumer glass aesthetic.
 */
import { useState } from 'react'
import { Fingerprint, LogIn, AlertCircle, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { WalletState } from '@/hooks/useCircleWallet'
import { LogoMark } from '@/components/Logo'

interface Props {
  state: WalletState
  error: string | null
  onRegister: (username: string) => void
  onLogin: () => void
}

const glass = {
  card: {
    background: 'rgba(255,255,255,0.72)',
    backdropFilter: 'blur(28px) saturate(180%)',
    WebkitBackdropFilter: 'blur(28px) saturate(180%)',
    border: '1px solid rgba(255,255,255,0.72)',
    boxShadow: '0 8px 40px rgba(18,45,69,0.10), inset 0 1px 0 rgba(255,255,255,0.60)',
  } as React.CSSProperties,
}

const spectral = 'linear-gradient(90deg,#5fbeff,#af8ff4,#f05c6b,#ffcd83,#7ef1b3)'

export function WalletSetup({ state, error, onRegister, onLogin }: Props) {
  const [username, setUsername] = useState('')
  const [tab, setTab] = useState<'register' | 'login'>('register')

  const busy = state === 'registering' || state === 'logging_in'

  return (
    <div
      className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4"
      style={{ background: 'linear-gradient(180deg,#f9f9fc 0%,#fffcf7 52%,#fbf7f2 100%)' }}
    >
      {/* Background blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div style={{ position:'absolute', top:'6%', left:'10%', width:360, height:360, borderRadius:'50%', background:'radial-gradient(circle,rgba(133,177,237,0.28) 0%,transparent 70%)', filter:'blur(70px)' }} />
        <div style={{ position:'absolute', bottom:'10%', right:'6%', width:320, height:320, borderRadius:'50%', background:'radial-gradient(circle,rgba(255,205,131,0.26) 0%,transparent 70%)', filter:'blur(64px)' }} />
        <div style={{ position:'absolute', top:'50%', left:'55%', width:200, height:200, borderRadius:'50%', background:'radial-gradient(circle,rgba(175,143,244,0.18) 0%,transparent 70%)', filter:'blur(50px)' }} />
      </div>

      <motion.div
        className="relative z-10 w-full max-w-sm"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Logo */}
        <div className="mb-10 text-center">
          <div className="mx-auto mb-5 flex justify-center">
            <LogoMark size={80} variant="dark" style={{ borderRadius: 22, boxShadow: '0 12px 40px rgba(18,45,69,0.18), 0 0 0 2px rgba(175,143,244,0.22)' }} />
          </div>
          <h1 className="display text-3xl font-bold" style={{ color:'#122d45', letterSpacing:'-0.035em' }}>
            Open<span style={{ fontWeight: 500 }}>Circle</span>
          </h1>
          <p className="mt-1.5 text-sm" style={{ color:'#6b6580' }}>
            Your self-custodial USDC wallet
          </p>
        </div>

        {/* Card */}
        <div className="overflow-hidden rounded-3xl" style={glass.card}>
          {/* Spectral strip */}
          <div className="h-1" style={{ background: spectral }} />

          <div className="px-6 pb-6 pt-5">
            {/* Tab toggle */}
            <div
              className="mb-6 flex rounded-2xl p-1"
              style={{ background: 'rgba(18,45,69,0.06)' }}
            >
              {(['register','login'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className="flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all"
                  style={{
                    background: tab === t ? '#fff' : 'transparent',
                    color: tab === t ? '#122d45' : '#6b6580',
                    boxShadow: tab === t ? '0 1px 4px rgba(18,45,69,0.10)' : 'none',
                  }}
                >
                  {t === 'register' ? 'New wallet' : 'Sign in'}
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              {tab === 'register' ? (
                <motion.div
                  key="register"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4"
                >
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest" style={{ color:'#8a849c' }}>
                      Wallet name
                    </label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="alice"
                      maxLength={64}
                      autoComplete="username webauthn"
                      className="w-full rounded-2xl px-4 py-3.5 text-sm outline-none transition-all"
                      style={{
                        background: 'rgba(255,255,255,0.46)',
                        color: '#122d45',
                        border: '1px solid rgba(255,255,255,0.56)',
                        fontFamily: "'DM Sans', sans-serif",
                      }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = '#85b1ed'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(133,177,237,0.18)' }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.56)'; e.currentTarget.style.boxShadow = 'none' }}
                    />
                  </div>
                  <button
                    disabled={busy || !username.trim()}
                    onClick={() => onRegister(username.trim())}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ background: '#122d45' }}
                  >
                    {busy && state === 'registering' ? (
                      <><Loader2 size={16} className="animate-spin" /> Creating wallet…</>
                    ) : (
                      <><Fingerprint size={16} /> Create with passkey</>
                    )}
                  </button>
                  <p className="text-center text-xs" style={{ color:'#8a849c' }}>
                    Stored on your device · No seed phrase · No passwords
                  </p>
                </motion.div>
              ) : (
                <motion.div
                  key="login"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4"
                >
                  <button
                    disabled={busy}
                    onClick={onLogin}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ background: '#122d45' }}
                  >
                    {busy && state === 'logging_in' ? (
                      <><Loader2 size={16} className="animate-spin" /> Signing in…</>
                    ) : (
                      <><LogIn size={16} /> Sign in with passkey</>
                    )}
                  </button>
                  <p className="text-center text-xs" style={{ color:'#8a849c' }}>
                    Use the passkey registered on this device.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 flex items-start gap-2 rounded-2xl p-3 text-xs"
                style={{ background:'rgba(186,43,76,0.08)', color:'#ba2b4c', border:'1px solid rgba(186,43,76,0.16)' }}
              >
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{error.slice(0, 160)}</span>
              </motion.div>
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-xs" style={{ color:'#8a849c' }}>
          Open source · 100% Circle · Arc Mainnet
        </p>
      </motion.div>
    </div>
  )
}
