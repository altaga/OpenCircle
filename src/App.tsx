/**
 * OpenCircle — open-source USDC wallet
 * Send · Receive · Swap · Bridge
 * Testnet + Mainnet (Arc)
 *
 * MAINNET WARNING: real funds, irreversible transactions.
 * The network toggle shows a hard confirmation modal before mainnet activates.
 */
import { useState } from 'react'
import { Send, QrCode, ArrowDownUp, ArrowLeftRight, LogOut, AlertTriangle, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { NetworkProvider, useNetwork } from '@/context/NetworkContext'
import { LogoFull } from '@/components/Logo'
import { useCircleWallet } from '@/hooks/useCircleWallet'
import { useUsdcBalance } from '@/hooks/useUsdcBalance'
import { WalletSetup } from '@/components/WalletSetup'
import { BalanceCard } from '@/components/BalanceCard'
import { SendPanel } from '@/components/SendPanel'
import { ReceivePanel } from '@/components/ReceivePanel'
import { SwapPanel } from '@/components/SwapPanel'
import { BridgePanel } from '@/components/BridgePanel'
import type { Hex } from 'viem'

type Tab = 'send' | 'receive' | 'swap' | 'bridge'

const TABS: { id: Tab; label: string; Icon: React.ElementType }[] = [
  { id: 'send',    label: 'Send',    Icon: Send },
  { id: 'receive', label: 'Receive', Icon: QrCode },
  { id: 'swap',    label: 'Swap',    Icon: ArrowDownUp },
  { id: 'bridge',  label: 'Bridge',  Icon: ArrowLeftRight },
]

// ── Mainnet warning modal ─────────────────────────────────────────────────────
function MainnetModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-end justify-center px-4 pb-6 sm:items-center"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      >
        {/* Backdrop */}
        <motion.div
          className="absolute inset-0 bg-black/40"
          style={{ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
          onClick={onCancel}
        />

        {/* Sheet */}
        <motion.div
          initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="relative w-full max-w-sm overflow-hidden rounded-3xl"
          style={{
            background: 'rgba(255,255,255,0.94)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(255,255,255,0.72)',
            boxShadow: '0 24px 80px rgba(18,45,69,0.22)',
          }}
        >
          <button
            onClick={onCancel}
            className="absolute right-4 top-4 rounded-xl p-1 transition-opacity hover:opacity-60"
          >
            <X size={16} style={{ color: '#6b6580' }} />
          </button>

          <div className="p-6">
            {/* Icon */}
            <div
              className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl"
              style={{ background: 'rgba(186,43,76,0.08)' }}
            >
              <AlertTriangle size={22} style={{ color: '#ba2b4c' }} />
            </div>

            <h2 className="display mb-2 text-xl font-bold" style={{ color: '#122d45', letterSpacing: '-0.02em' }}>
              Switch to Mainnet?
            </h2>
            <p className="mb-4 text-sm leading-relaxed" style={{ color: '#6b6580' }}>
              Mainnet involves <strong style={{ color: '#122d45' }}>real USDC</strong>. Transactions
              are irreversible once submitted. You need a separate mainnet Client Key
              (starts with <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">LIVE_API_KEY:</code>)
              set as <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">VITE_CLIENT_KEY_MAINNET</code>.
            </p>

            <ul className="mb-5 space-y-1.5 text-xs" style={{ color: '#6b6580' }}>
              {[
                'Passkeys are network-scoped — your testnet wallet is not accessible on mainnet.',
                'You must configure a Gas Station paymaster policy for mainnet in Circle Console.',
                'All transactions on mainnet have finality — there is no undo.',
              ].map((t, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: '#ba2b4c' }} />
                  {t}
                </li>
              ))}
            </ul>

            <div className="flex gap-3">
              <button
                onClick={onCancel}
                className="flex-1 rounded-2xl py-3 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99]"
                style={{ background: 'rgba(18,45,69,0.07)', color: '#122d45' }}
              >
                Stay on Testnet
              </button>
              <button
                onClick={onConfirm}
                className="flex-1 rounded-2xl py-3 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99]"
                style={{ background: '#ba2b4c' }}
              >
                I understand — Switch
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ── Network toggle pill ───────────────────────────────────────────────────────
function NetworkToggle() {
  const { config, setNetwork, isMainnet } = useNetwork()
  const [showModal, setShowModal] = useState(false)

  const handleToggle = () => {
    if (!isMainnet) {
      setShowModal(true)  // guard before switching to mainnet
    } else {
      setNetwork('testnet')
    }
  }

  return (
    <>
      <button
        onClick={handleToggle}
        className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all hover:scale-105 active:scale-95"
        style={{
          background: isMainnet ? 'rgba(186,43,76,0.10)' : 'rgba(18,45,69,0.07)',
          color: isMainnet ? '#ba2b4c' : '#6b6580',
          border: `1px solid ${isMainnet ? 'rgba(186,43,76,0.20)' : 'rgba(255,255,255,0.66)'}`,
        }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: isMainnet ? '#ba2b4c' : '#1a8047' }}
        />
        {config.network === 'mainnet' ? 'Mainnet' : 'Testnet'}
      </button>

      {showModal && (
        <MainnetModal
          onConfirm={() => { setNetwork('mainnet'); setShowModal(false) }}
          onCancel={() => setShowModal(false)}
        />
      )}
    </>
  )
}

// ── Inner app (needs NetworkContext) ─────────────────────────────────────────
function AppInner() {
  const { config: netConfig, isMainnet } = useNetwork()
  const wallet  = useCircleWallet(netConfig)
  const balance = useUsdcBalance(wallet.state === 'ready' ? wallet.address : null, netConfig)
  const [tab, setTab] = useState<Tab>('send')

  if (wallet.state !== 'ready') {
    return (
      <WalletSetup
        state={wallet.state}
        error={wallet.txError}
        onRegister={(u) => void wallet.register(u)}
        onLogin={() => void wallet.login()}
      />
    )
  }

  return (
    <div
      className="relative min-h-dvh overflow-x-hidden"
      style={{ background: isMainnet
        ? 'linear-gradient(180deg,#fff5f5 0%,#fffcf7 52%,#fbf7f2 100%)'
        : 'linear-gradient(180deg,#f9f9fc 0%,#fffcf7 52%,#fbf7f2 100%)' }}
    >
      {/* Ambient blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div style={{ position:'absolute', top:'4%',  left:'0%',  width:380, height:380, borderRadius:'50%', background: isMainnet ? 'radial-gradient(circle,rgba(237,133,133,0.22) 0%,transparent 70%)' : 'radial-gradient(circle,rgba(133,177,237,0.24) 0%,transparent 70%)', filter:'blur(80px)' }} />
        <div style={{ position:'absolute', bottom:'8%', right:'2%', width:340, height:340, borderRadius:'50%', background:'radial-gradient(circle,rgba(255,205,131,0.22) 0%,transparent 70%)', filter:'blur(70px)' }} />
        <div style={{ position:'absolute', top:'45%', left:'55%', width:220, height:220, borderRadius:'50%', background:'radial-gradient(circle,rgba(175,143,244,0.16) 0%,transparent 70%)', filter:'blur(56px)' }} />
      </div>

      <div className="relative z-10 mx-auto max-w-md px-4 pb-28 pt-6">

        {/* Header */}
        <header className="mb-5 flex items-center justify-between">
          <LogoFull height={36} />

          <div className="flex items-center gap-2">
            <NetworkToggle />
            <button
              onClick={wallet.logout}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-all hover:scale-105 active:scale-95"
              style={{
                background:'rgba(255,255,255,0.60)',
                backdropFilter:'blur(12px)',
                WebkitBackdropFilter:'blur(12px)',
                border:'1px solid rgba(255,255,255,0.66)',
                color:'#6b6580',
              }}
            >
              <LogOut size={13} />
              Sign out
            </button>
          </div>
        </header>

        {/* Mainnet banner */}
        {isMainnet && (
          <motion.div
            initial={{ opacity:0, y:-8 }} animate={{ opacity:1, y:0 }}
            className="mb-4 flex items-center gap-2 rounded-2xl px-4 py-3"
            style={{ background:'rgba(186,43,76,0.07)', border:'1px solid rgba(186,43,76,0.18)' }}
          >
            <AlertTriangle size={14} style={{ color:'#ba2b4c', flexShrink:0 }} />
            <p className="text-xs font-medium" style={{ color:'#ba2b4c' }}>
              Mainnet — transactions involve real USDC and are irreversible.
            </p>
          </motion.div>
        )}

        {/* Hero balance */}
        <div className="mb-5">
          <BalanceCard
            address={wallet.address}
            balance={balance.display}
            loading={balance.loading}
            onRefresh={() => void balance.refresh()}
          />
        </div>

        {/* Tab content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`${tab}-${netConfig.network}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {tab === 'send'    && (
              <SendPanel
                balance={balance.display}
                rawBalance={balance.raw}
                txState={wallet.txState}
                txHash={wallet.txHash}
                txError={wallet.txError}
                onSend={(to: Hex, amount: string) => void wallet.sendUsdc(to, amount)}
              />
            )}
            {tab === 'receive' && <ReceivePanel address={wallet.address} />}
            {tab === 'swap'    && <SwapPanel />}
            {tab === 'bridge'  && <BridgePanel />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom tab bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-20"
        style={{
          background:'rgba(255,255,255,0.82)',
          backdropFilter:'blur(28px) saturate(180%)',
          WebkitBackdropFilter:'blur(28px) saturate(180%)',
          borderTop:'1px solid rgba(255,255,255,0.72)',
          boxShadow:'0 -4px 24px rgba(18,45,69,0.07)',
        }}
      >
        <div className="mx-auto flex max-w-md items-center px-2 pb-safe">
          {TABS.map(({ id, label, Icon }) => {
            const active = tab === id
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className="flex flex-1 flex-col items-center gap-1 py-3.5 transition-all active:scale-95"
              >
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-xl transition-all"
                  style={{ background: active ? 'rgba(18,45,69,0.10)' : 'transparent' }}
                >
                  <Icon size={18} style={{ color: active ? '#122d45' : '#8a849c' }} />
                </div>
                <span className="text-xs font-semibold" style={{ color: active ? '#122d45' : '#8a849c' }}>
                  {label}
                </span>
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <NetworkProvider>
      <AppInner />
    </NetworkProvider>
  )
}
