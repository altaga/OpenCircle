/**
 * Generates OpenCircle PWA icons in pure Node.js — no native deps.
 *
 * Mark: open-C arc (270° CW, opens right) + central dot, on a #122d45
 * rounded-square background with a spectral gradient.
 */
import { createWriteStream } from 'fs'
import { createDeflate } from 'zlib'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))

// ── Minimal PNG writer ────────────────────────────────────────────────────────
function buildCrcTable() {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    t[i] = c
  }
  return t
}
const CRC_TABLE = buildCrcTable()

function crc32(buf) {
  let crc = 0xffffffff
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function u32be(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data)
  return Buffer.concat([u32be(d.length), t, d, u32be(crc32(Buffer.concat([t, d])))])
}

async function writePng(fpath, pixels, size) {
  // pixels: Uint8Array RGBA size*size*4
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8]=8; ihdr[9]=6 // 8-bit RGBA

  const raw = Buffer.alloc(size * (1 + size * 4))
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4
      const d = y * (1 + size * 4) + 1 + x * 4
      raw[d] = pixels[s]; raw[d+1] = pixels[s+1]; raw[d+2] = pixels[s+2]; raw[d+3] = pixels[s+3]
    }
  }

  await new Promise((res, rej) => {
    const parts = []
    const def = createDeflate({ level: 6 })
    def.on('data', d => parts.push(d))
    def.on('end', () => {
      const out = Buffer.concat([
        Buffer.from([137,80,78,71,13,10,26,10]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', Buffer.concat(parts)),
        pngChunk('IEND', Buffer.alloc(0)),
      ])
      const ws = createWriteStream(fpath)
      ws.write(out); ws.end()
      ws.on('finish', res); ws.on('error', rej)
    })
    def.on('error', rej)
    def.end(raw)
  })
}

// ── Colour helpers ────────────────────────────────────────────────────────────
function hex(h) {
  const n = parseInt(h.slice(1), 16)
  return [(n>>16)&255,(n>>8)&255,n&255]
}

// Spectral gradient: maps t∈[0,1] → RGB
function spectral(t) {
  const stops = [
    [0.00, hex('#85B1ED')],
    [0.50, hex('#AF8FF4')],
    [1.00, hex('#FFCD83')],
  ]
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i], [t1, c1] = stops[i+1]
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0)
      return [
        Math.round(c0[0] + f*(c1[0]-c0[0])),
        Math.round(c0[1] + f*(c1[1]-c0[1])),
        Math.round(c0[2] + f*(c1[2]-c0[2])),
      ]
    }
  }
  return stops[stops.length-1][1]
}

// ── Rasteriser ────────────────────────────────────────────────────────────────
function drawIcon(size, maskable = false) {
  const pixels = new Uint8Array(size * size * 4)
  const cx = size / 2, cy = size / 2
  const bg = hex('#122d45')
  const cornerR = maskable ? size * 0.20 : size * 0.22

  // Arc geometry (scaled to [0,size])
  const arcR    = size * 0.28          // arc radius
  const dotR    = size * 0.065         // center dot radius
  const stroke  = size * 0.09          // arc stroke half-width
  const padInner = maskable ? size * 0.14 : 0  // extra safe-zone padding

  // Arc: open-C facing right
  // Start: 315° = -45° → (cx + arcR*cos(-45°), cy + arcR*sin(-45°))
  // End:    45°         → (cx + arcR*cos(45°),  cy + arcR*sin(45°))
  // Gap on the right side (x > cx + arcR*cos(22.5°))

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy

      // ── Background mask ──
      if (maskable) {
        // Rounded square
        const rx = Math.abs(dx), ry = Math.abs(dy)
        const safe = size * 0.5 - cornerR
        const inRR = rx < safe || ry < safe ||
          (rx-safe)**2 + (ry-safe)**2 < cornerR**2
        if (!inRR) { pixels[(y*size+x)*4+3] = 0; continue }
      } else {
        // Circle
        if (dx*dx + dy*dy > (cx - padInner)**2) { pixels[(y*size+x)*4+3] = 0; continue }
      }

      // Default: background color
      let [r,g,b,a] = [...bg, 255]

      // ── Arc stroke ──
      const distFromCenter = Math.sqrt(dx*dx + dy*dy)
      const distFromArc    = Math.abs(distFromCenter - arcR)
      const angle = Math.atan2(dy, dx) // [-π, π]

      // The gap is the arc from -45° to +45° (right side opening).
      // We draw the arc for angles NOT in [-π/4, π/4].
      const inGap = angle >= -Math.PI/4 && angle <= Math.PI/4

      if (!inGap && distFromArc < stroke) {
        // Gradient position along the arc: map angle to t
        // Arc goes from -45° CCW (i.e., from 315° = -45° down around to 45°)
        // Normalise: map [-π, -π/4] ∪ [π/4, π] → [0, 1]
        let norm = angle < 0
          ? (angle + Math.PI) / (Math.PI * 0.75)   // bottom half
          : (Math.PI - angle) / (Math.PI * 0.75)   // top half (mirrored for smooth gradient)
        norm = Math.max(0, Math.min(1, norm))
        const [sr,sg,sb] = spectral(norm)
        // Anti-alias at stroke edge
        const edge = Math.max(0, 1 - (distFromArc / stroke - 0.7) / 0.3)
        r = Math.round(r*(1-edge) + sr*edge)
        g = Math.round(g*(1-edge) + sg*edge)
        b = Math.round(b*(1-edge) + sb*edge)
        a = 255
      }

      // ── Center dot ──
      if (distFromCenter < dotR) {
        const t = 0.5 // midpoint of gradient for dot
        ;[r,g,b] = spectral(t)
        a = 255
      }

      pixels[(y*size+x)*4]   = r
      pixels[(y*size+x)*4+1] = g
      pixels[(y*size+x)*4+2] = b
      pixels[(y*size+x)*4+3] = a
    }
  }
  return pixels
}

// ── Render all sizes ──────────────────────────────────────────────────────────
const tasks = [
  { name: 'icon-192x192.png',     size: 192, maskable: false },
  { name: 'icon-512x512.png',     size: 512, maskable: false },
  { name: 'maskable-512x512.png', size: 512, maskable: true  },
  { name: 'apple-touch-icon.png', size: 180, maskable: false },
]

for (const t of tasks) {
  await writePng(join(__dir, t.name), drawIcon(t.size, t.maskable), t.size)
  console.log(`✓ ${t.name} (${t.size}×${t.size})`)
}
console.log('Done.')
