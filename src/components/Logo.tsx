/**
 * OpenCircle logo components.
 *
 * <LogoMark />  — square icon only (for app icon, favicons, small spaces)
 * <LogoFull />  — icon + wordmark (for headers, splash screens)
 *
 * Design: an open-C arc (the "open" in OpenCircle, and an arc referencing
 * the Arc chain) with a central coin dot representing USDC.
 * Spectral gradient: indigo blue → soft violet → warm amber.
 * No strokes below 1px. Works at any size from 16px to 512px.
 */
import type { SVGProps } from 'react'

interface LogoMarkProps extends SVGProps<SVGSVGElement> {
  size?: number
  /** 'dark' = white mark on #122d45 bg (default). 'light' = dark mark on transparent bg. */
  variant?: 'dark' | 'light'
}

export function LogoMark({ size = 40, variant = 'dark', ...props }: LogoMarkProps) {
  const id = `oc-grad-${size}-${variant}`
  const bg = variant === 'dark' ? '#122d45' : 'none'

  // Arc geometry: center = (50,50), radius = 28
  // Open-C facing right: start 315° (top-right), end 45° (bottom-right), 270° CW
  // 315° → x=50+28cos(-45°)=69.8, y=50+28sin(-45°)=30.2
  // 45°  → x=50+28cos(45°)=69.8,  y=50+28sin(45°)=69.8
  const cx = 50, cy = 50, r = 28
  const startX = cx + r * Math.cos(-Math.PI / 4)   // 69.80
  const startY = cy + r * Math.sin(-Math.PI / 4)   // 30.20
  const endX   = cx + r * Math.cos(Math.PI / 4)    // 69.80
  const endY   = cy + r * Math.sin(Math.PI / 4)    // 69.80

  const gradId = id

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <defs>
        <linearGradient id={gradId} x1="20" y1="20" x2="80" y2="80" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#85B1ED" />
          <stop offset="50%"  stopColor="#AF8FF4" />
          <stop offset="100%" stopColor="#FFCD83" />
        </linearGradient>
      </defs>

      {/* Background */}
      {variant === 'dark' && (
        <rect x="0" y="0" width="100" height="100" rx="22" fill={bg} />
      )}

      {/* Open-C arc: 270° sweep, opens to the right */}
      <path
        d={`M ${startX.toFixed(2)} ${startY.toFixed(2)} A ${r} ${r} 0 1 0 ${endX.toFixed(2)} ${endY.toFixed(2)}`}
        stroke={`url(#${gradId})`}
        strokeWidth="9"
        strokeLinecap="round"
        fill="none"
      />

      {/* Central USDC coin dot */}
      <circle cx={cx} cy={cy} r="6.5" fill={`url(#${gradId})`} />

      {/* Optional: tiny tick marks at arc ends for "open" emphasis (only at larger sizes) */}
      {size >= 24 && (
        <>
          {/* Top tick — small line pointing inward from arc start */}
          <line
            x1={startX.toFixed(2)} y1={startY.toFixed(2)}
            x2={(startX - 5).toFixed(2)} y2={(startY + 2).toFixed(2)}
            stroke={variant === 'dark' ? 'rgba(255,255,255,0.25)' : 'rgba(18,45,69,0.20)'}
            strokeWidth="2"
            strokeLinecap="round"
          />
          {/* Bottom tick */}
          <line
            x1={endX.toFixed(2)} y1={endY.toFixed(2)}
            x2={(endX - 5).toFixed(2)} y2={(endY - 2).toFixed(2)}
            stroke={variant === 'dark' ? 'rgba(255,255,255,0.25)' : 'rgba(18,45,69,0.20)'}
            strokeWidth="2"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  )
}

interface LogoFullProps {
  height?: number
  /** Color of the wordmark text */
  textColor?: string
  /** Color of the tagline */
  taglineColor?: string
  markVariant?: 'dark' | 'light'
}

export function LogoFull({
  height = 40,
  textColor = '#122d45',
  taglineColor = '#8a849c',
  markVariant = 'dark',
}: LogoFullProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: height * 0.3 }}>
      <LogoMark size={height} variant={markVariant} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        <span
          style={{
            fontFamily: "'Space Grotesk', 'DM Sans', system-ui, sans-serif",
            fontSize: height * 0.52,
            fontWeight: 700,
            color: textColor,
            letterSpacing: '-0.03em',
            lineHeight: 1.15,
          }}
        >
          Open<span style={{ fontWeight: 500 }}>Circle</span>
        </span>
        {height >= 36 && (
          <span
            style={{
              fontFamily: "'DM Sans', system-ui, sans-serif",
              fontSize: height * 0.24,
              fontWeight: 400,
              color: taglineColor,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              lineHeight: 1,
            }}
          >
            USDC Wallet
          </span>
        )}
      </div>
    </div>
  )
}
