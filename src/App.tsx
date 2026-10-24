/**
 * OpenCircle — open-source USDC wallet
 * Send · Receive · Swap · Bridge · Arc Mainnet
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { Send, QrCode, ArrowDownUp, ArrowLeftRight, LogOut, Bot, X, AlertTriangle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { NetworkProvider, useNetwork } from '@/context/NetworkContext'
import { LogoFull } from '@/components/Logo'
import { useCircleWallet, shortAddress } from '@/hooks/useCircleWallet'
import { useUsdcBalance } from '@/hooks/useUsdcBalance'
import { WalletSetup } from '@/components/WalletSetup'
import { BalanceCard } from '@/components/BalanceCard'
import { SendPanel } from '@/components/SendPanel'
import { ReceivePanel } from '@/components/ReceivePanel'
import { SwapPanel } from '@/components/SwapPanel'
import { BridgePanel } from '@/components/BridgePanel'
import { InstallBanner } from '@/components/InstallBanner'
import { SessionPersistenceWarning } from '@/components/SessionPersistenceWarning'
import { SplashScreen } from '@/components/SplashScreen'
import { AgentPanel } from '@/components/AgentPanel'
import { useAgent } from '@/hooks/useAgent'
import { useAppKitActions } from '@/hooks/useAppKitActions'
import type { ToolContext } from '@/lib/agent-tools'
import type { Hex } from 'viem'

type Tab = 'send' | 'receive' | 'swap' | 'bridge' | 'agent'

const TABS: { id: Tab; label: string; Icon: React.ElementType }[] = [
  { id: 'send',    label: 'Send',    Icon: Send },
  { id: 'receive', label: 'Receive', Icon: QrCode },
  { id: 'swap',    label: 'Swap',    Icon: ArrowDownUp },
  { id: 'bridge',  label: 'Bridge',  Icon: ArrowLeftRight },
  { id: 'agent',   label: 'Agent',   Icon: Bot },
]

function AppInner() {
  const { config: netConfig } = useNetwork()
  const wallet  = useCircleWallet(netConfig)
  const balance = useUsdcBalance(wallet.state === 'ready' ? wallet.address : null, netConfig)
  const [tab, setTab] = useState<Tab>('send')
  const [confirmingLogout, setConfirmingLogout] = useState(false)
  // The actual sign-out is a two-step gate: this confirm modal proves intent
  // ("you typed the button, you saw the warning"), and `wallet.logout()` then
  // proves identity via WebAuthn re-auth. Both are required.
  const handleSignOut = () => setConfirmingLogout(true)
  const handleConfirmSignOut = async () => {
    setConfirmingLogout(false)
    const wiped = await wallet.logout()
    if (!wiped) {
      toast.error("Couldn't verify your passkey. Sign out cancelled.")
    }
  }

  // The agent executes its tools here, not on the server: this is where the
  // Circle client key and the passkey live. Null until the wallet is ready.
  // `sendUsdc` is the agent's write tool entry point; `swapUsdc` / `bridgeUsdc`
  // route through the shared `useAppKitActions` hook so the panels and the
  // agent go through the same wagmi-connector + AppKit wiring. Every write
  // tool is gated by an in-chat proposal card AND a WebAuthn prompt.
  const appKit = useAppKitActions()
  const toolCtx: ToolContext | null =
    wallet.state === 'ready'
      ? {
          address: wallet.address,
          clientKey: netConfig.clientKey,
          chainPath: netConfig.chainPath,
          usdcContractAddress: netConfig.usdcContractAddress as Hex,
          sendUsdc: wallet.sendUsdc,
          swapUsdc: appKit.swapUsdc,
          bridgeUsdc: appKit.bridgeUsdc,
        }
      : null
  const agent = useAgent(toolCtx)

  // Holds the frame while IndexedDB is consulted, so a returning user never
  // sees the sign-in card flash before the dashboard.
  if (wallet.state === 'restoring') return <SplashScreen />

  if (wallet.state !== 'ready') {
    return (
      <WalletSetup
        state={wallet.state}
        error={wallet.txError}
        remember={wallet.remember}
        onRemember={wallet.setRemember}
        onRegister={(u) => void wallet.register(u)}
        onLogin={() => void wallet.login()}
      />
    )
  }

  return (
    <div
      className="relative min-h-dvh overflow-x-hidden"
      style={{ background: 'linear-gradient(180deg,#f9f9fc 0%,#fffcf7 52%,#fbf7f2 100%)' }}
    >
      {/* Ambient blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div style={{ position:'absolute', top:'4%', left:'0%', width:380, height:380, borderRadius:'50%', background:'radial-gradient(circle,rgba(133,177,237,0.24) 0%,transparent 70%)', filter:'blur(80px)' }} />
        <div style={{ position:'absolute', bottom:'8%', right:'2%', width:340, height:340, borderRadius:'50%', background:'radial-gradient(circle,rgba(255,205,131,0.22) 0%,transparent 70%)', filter:'blur(70px)' }} />
        <div style={{ position:'absolute', top:'45%', left:'55%', width:220, height:220, borderRadius:'50%', background:'radial-gradient(circle,rgba(175,143,244,0.16) 0%,transparent 70%)', filter:'blur(56px)' }} />
      </div>

      <div className={`relative z-10 mx-auto max-w-md px-4 pt-5 ${tab === 'agent' ? 'pb-20' : 'pb-28'}`}>

        {/* Header */}
        <header className="mb-4 flex items-center justify-between">
          <LogoFull height={34} />
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all hover:scale-105 active:scale-95"
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
        </header>

        {/* Balance representation: Full card for transacting panels, compact status ticker for AI agent */}
        {tab !== 'agent' ? (
          <div className="mb-5">
            <BalanceCard
              address={wallet.address}
              balance={balance.display}
              loading={balance.loading}
              onRefresh={() => void balance.refresh()}
            />
          </div>
        ) : (
          <div
            className="mb-2.5 flex items-center justify-between rounded-2xl px-3.5 py-2 shadow-2xs"
            style={{
              background: 'rgba(255,255,255,0.78)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid rgba(255,255,255,0.85)',
            }}
          >
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20" />
              <span className="text-xs font-bold text-[#122d45]">
                {balance.display} USDC
              </span>
              <span className="text-[11px] text-[#8a849c]">· Arc Mainnet</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(wallet.address)
                  toast.success('Address copied')
                }}
                className="font-mono text-[11px] font-medium text-[#8a849c] transition-colors hover:text-[#122d45]"
                title="Copy full address"
              >
                {shortAddress(wallet.address)}
              </button>
              <button
                onClick={() => void balance.refresh()}
                disabled={balance.loading}
                className="text-[11px] font-semibold text-[#1061a6] transition-opacity hover:opacity-80 active:scale-95"
              >
                {balance.loading ? 'Syncing…' : 'Sync'}
              </button>
            </div>
          </div>
        )}

        {/* Tab content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            {tab === 'send'    && (
              <SendPanel
                balance={balance.display}
                rawBalance={balance.raw}
                txState={wallet.txState}
                txHash={wallet.txHash}
                txError={wallet.txError}
                onSend={(to: Hex, amount: string) => { void wallet.sendUsdc(to, amount).catch(() => {}) }}
              />
            )}
            {tab === 'receive' && <ReceivePanel address={wallet.address} />}
            {tab === 'swap'    && <SwapPanel />}
            {tab === 'bridge'  && <BridgePanel />}
            {tab === 'agent'   && (
              <AgentPanel
                messages={agent.messages}
                busy={agent.busy}
                error={agent.error}
                pendingProposals={agent.pendingProposals}
                onSend={(t) => void agent.send(t)}
                onStop={agent.stop}
                onReset={agent.reset}
                onConfirmProposal={agent.confirmProposal}
                onCancelProposal={agent.cancelProposal}
              />
            )}
          </motion.div>
        </AnimatePresence>

        {tab !== 'agent' && (
          <>
            <InstallBanner className="mt-5" />
            <SessionPersistenceWarning className="mt-2" />
          </>
        )}
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

      {/* Sign-out confirm modal — second gate (after the WebAuthn re-auth in
          `wallet.logout`). The user has to tap through both to wipe the
          remembered wallet. */}
      <AnimatePresence>
        {confirmingLogout && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex items-center justify-center px-6"
            style={{ background: 'rgba(18,45,69,0.42)', backdropFilter: 'blur(6px)' }}
            onClick={() => setConfirmingLogout(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="signout-title"
              className="w-full max-w-sm rounded-3xl p-5"
              style={{
                background: 'rgba(255,255,255,0.92)',
                backdropFilter: 'blur(40px) saturate(180%)',
                WebkitBackdropFilter: 'blur(40px) saturate(180%)',
                border: '1px solid rgba(255,255,255,0.78)',
                boxShadow: '0 20px 60px rgba(18,45,69,0.18)',
              }}
            >
              <div className="mb-3 flex items-start justify-between">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-xl"
                  style={{ background: 'rgba(255,205,131,0.22)' }}
                >
                  <AlertTriangle size={18} style={{ color: '#a06400' }} />
                </div>
                <button
                  onClick={() => setConfirmingLogout(false)}
                  aria-label="Close"
                  className="rounded-lg p-1 transition-opacity hover:opacity-60"
                  style={{ color: '#8a849c' }}
                >
                  <X size={16} />
                </button>
              </div>
              <h2 id="signout-title" className="text-base font-bold" style={{ color: '#122d45' }}>
                Sign out?
              </h2>
              <p className="mt-1.5 text-sm" style={{ color: '#4a5168' }}>
                You'll need your passkey to sign back in. If the passkey is on
                this device, you can clear it; if it's stored elsewhere, you
                won't be able to recover this wallet.
              </p>
              <div className="mt-5 flex gap-2">
                <button
                  onClick={() => setConfirmingLogout(false)}
                  className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all active:scale-95"
                  style={{
                    background: 'rgba(255,255,255,0.7)',
                    border: '1px solid rgba(138,132,156,0.18)',
                    color: '#4a5168',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleConfirmSignOut()}
                  className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all active:scale-95"
                  style={{ background: '#c8331a' }}
                >
                  Sign out
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function App() {
  return (
    <NetworkProvider>
      <AppInner />
    </NetworkProvider>
  )
}