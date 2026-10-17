/**
 * SplashScreen — shown while the app works out whether a wallet exists here.
 *
 * Without it the app briefly paints the sign-in card and then snaps to the
 * dashboard, which reads as a glitch. This holds the frame instead.
 *
 * The minimum duration only applies when a wallet was actually restored: a
 * first-time visitor should never wait on a delay meant for someone else.
 */
import { motion } from 'framer-motion'
import { LogoMark } from '@/components/Logo'

const spectral = 'linear-gradient(90deg,#5fbeff,#af8ff4,#f05c6b,#ffcd83,#7ef1b3)'

export function SplashScreen({ label = 'Restoring your wallet' }: { label?: string }) {
  return (
    <div
      className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4"
      style={{ background: 'linear-gradient(180deg,#f9f9fc 0%,#fffcf7 52%,#fbf7f2 100%)' }}
    >
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div style={{ position:'absolute', top:'8%', left:'12%', width:360, height:360, borderRadius:'50%', background:'radial-gradient(circle,rgba(133,177,237,0.26) 0%,transparent 70%)', filter:'blur(70px)' }} />
        <div style={{ position:'absolute', bottom:'12%', right:'8%', width:320, height:320, borderRadius:'50%', background:'radial-gradient(circle,rgba(255,205,131,0.24) 0%,transparent 70%)', filter:'blur(64px)' }} />
      </div>

      <div className="relative z-10 flex flex-col items-center">
        <div className="relative">
          {/* Breathing halo so the screen reads as alive, not frozen. */}
          <motion.div
            aria-hidden
            className="absolute inset-0 rounded-[26px]"
            style={{ boxShadow: '0 0 0 2px rgba(175,143,244,0.40)' }}
            animate={{ scale: [1, 1.14, 1], opacity: [0.6, 0.1, 0.6] }}
            transition={{ duration: 2.1, repeat: Infinity, ease: 'easeInOut' }}
          />
          <LogoMark
            size={80}
            variant="dark"
            style={{ borderRadius: 22, boxShadow: '0 12px 40px rgba(18,45,69,0.18)' }}
          />
        </div>

        <h1
          className="display mt-8 text-3xl font-bold"
          style={{ color: '#122d45', letterSpacing: '-0.035em' }}
        >
          Open<span style={{ fontWeight: 500 }}>Circle</span>
        </h1>

        <p className="mt-2 text-sm" style={{ color: '#6b6580' }}>{label}</p>

        {/* Indeterminate sweep — it is not a real progress bar, so it must not
            look like one: no percentage, no staged stops. */}
        <div
          className="mt-7 h-1 w-44 overflow-hidden rounded-full"
          style={{ background: 'rgba(18,45,69,0.08)' }}
        >
          <motion.div
            className="h-full w-1/3 rounded-full"
            style={{ background: spectral }}
            animate={{ x: ['-120%', '340%'] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

        <p className="sr-only" role="status" aria-live="polite">{label}</p>
      </div>
    </div>
  )
}