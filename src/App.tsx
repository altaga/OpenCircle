/**
 * OpenCircle — open-source USDC wallet
 * Send · Receive · Swap · Bridge · Arc Mainnet
 */
import { useState } from 'react'
import { Send, QrCode, ArrowDownUp, ArrowLeftRight, LogOut } from 'lucide-react'
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

function AppInner() {
  const { config: netConfig } = useNetwork()
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
      style={{ background: 'linear-gradient(180deg,#f9f9fc 0%,#fffcf7 52%,#fbf7f2 100%)' }}
    >
      {/* Ambient blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div style={{ position:'absolute', top:'4%', left:'0%', width:380, height:380, borderRadius:'50%', background:'radial-gradient(circle,rgba(133,177,237,0.24) 0%,transparent 70%)', filter:'blur(80px)' }} />
        <div style={{ position:'absolute', bottom:'8%', right:'2%', width:340, height:340, borderRadius:'50%', background:'radial-gradient(circle,rgba(255,205,131,0.22) 0%,transparent 70%)', filter:'blur(70px)' }} />
        <div style={{ position:'absolute', top:'45%', left:'55%', width:220, height:220, borderRadius:'50%', background:'radial-gradient(circle,rgba(175,143,244,0.16) 0%,transparent 70%)', filter:'blur(56px)' }} />
      </div>

      <div className="relative z-10 mx-auto max-w-md px-4 pb-28 pt-6">

        {/* Header */}
        <header className="mb-5 flex items-center justify-between">
          <LogoFull height={36} />
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
        </header>

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
            key={tab}
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

export default function App() {
  return (
    <NetworkProvider>
      <AppInner />
    </NetworkProvider>
  )
}
