/**
 * Generates OpenCircle PWA icons using pure Node.js canvas.
 * Run: node gen-icons.mjs
 */
import { createCanvas } from 'canvas'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))

function makeIcon(size, maskable = false) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  const r = size / 2
  const pad = maskable ? size * 0.15 : size * 0.06
  const innerR = r - pad

  // Background
  ctx.fillStyle = '#122d45'
  ctx.beginPath()
  if (maskable) {
    ctx.roundRect(0, 0, size, size, size * 0.2)
  } else {
    ctx.arc(r, r, innerR, 0, Math.PI * 2)
  }
  ctx.fill()

  // Spectral ring (gradient stroke)
  const grad = ctx.createLinearGradient(0, 0, size, size)
  grad.addColorStop(0, '#85B1ED')
  grad.addColorStop(0.4, '#AF8FF4')
  grad.addColorStop(0.7, '#FFCD83')
  grad.addColorStop(1, '#F47070')
  ctx.strokeStyle = grad
  ctx.lineWidth = size * 0.04
  ctx.beginPath()
  if (maskable) {
    const ringPad = size * 0.08
    ctx.roundRect(ringPad, ringPad, size - ringPad * 2, size - ringPad * 2, size * 0.16)
  } else {
    ctx.arc(r, r, innerR - size * 0.02, 0, Math.PI * 2)
  }
  ctx.stroke()

  // OpenCircle "O+" mark — circle + crosshair
  const markR = innerR * 0.44
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = size * 0.055
  ctx.lineCap = 'round'
  // Outer circle
  ctx.beginPath()
  ctx.arc(r, r, markR, 0, Math.PI * 2)
  ctx.stroke()
  // Horizontal line
  ctx.beginPath()
  ctx.moveTo(r - markR * 0.6, r)
  ctx.lineTo(r + markR * 0.6, r)
  ctx.stroke()
  // Vertical line
  ctx.beginPath()
  ctx.moveTo(r, r - markR * 0.6)
  ctx.lineTo(r, r + markR * 0.6)
  ctx.stroke()

  return canvas.toBuffer('image/png')
}

const sizes = [72, 96, 128, 144, 152, 192, 384, 512]
for (const s of sizes) {
  writeFileSync(join(__dir, `icon-${s}x${s}.png`), makeIcon(s, false))
  console.log(`icon-${s}x${s}.png`)
}
writeFileSync(join(__dir, 'maskable-512x512.png'), makeIcon(512, true))
console.log('maskable-512x512.png')
writeFileSync(join(__dir, 'apple-touch-icon.png'), makeIcon(180, false))
console.log('apple-touch-icon.png')
console.log('Done.')
