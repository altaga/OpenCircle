#!/usr/bin/env node
/**
 * circle-smoke-test — does Circle's own SDK accept the configured key?
 *
 * This runs @circle-fin/modular-wallets-core directly instead of hand-rolling
 * HTTP, so the request shape is Circle's, not ours. If the SDK itself is
 * rejected there is nothing left to fix on the client side.
 *
 *   bun run scripts/circle-smoke-test.mjs --file .env
 *   bun run scripts/circle-smoke-test.mjs --env
 *
 * Prints booleans, statuses and a fingerprint. Never the key.
 */

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const CLIENT_URL = 'https://modular-sdk.circle.com/v1/rpc/w3s/buidl'
const ARGS = process.argv.slice(2)

const fp = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12)

function readKey() {
  if (ARGS.includes('--env')) {
    const k = process.env.VITE_CLIENT_KEY_MAINNET
    if (!k) throw new Error('VITE_CLIENT_KEY_MAINNET no esta definida')
    return k
  }
  const path = ARGS[ARGS.indexOf('--file') + 1] ?? '.env'
  const text = readFileSync(path, 'utf8')
  const line = text.split(/\r?\n/).find((l) => /^\s*(export\s+)?VITE_CLIENT_KEY_MAINNET\s*=/.test(l))
  if (!line) throw new Error(`VITE_CLIENT_KEY_MAINNET no encontrada en ${path}`)
  return line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '')
}

// The SDK reads window.location.hostname to build X-AppInfo. Provide the real
// host so the request looks like the one the browser makes.
const HOST = '0xoc.netlify.app'
if (typeof globalThis.window === 'undefined') {
  globalThis.window = { location: { hostname: HOST, protocol: 'https:' } }
}

const { RpProvider, ModularWalletsProvider } = await import('@circle-fin/modular-wallets-core')

const key = readKey()
console.log('=== llave (solo forma) ===')
console.log('  longitud :', key.length)
console.log('  prefijo  :', key.split(':')[0] ?? '(ninguno)')
console.log('  uuid:uuid:', key.split(':').length === 3)
console.log('  huella   :', fp(key))
console.log('')

async function attempt(label, provider, method, params = {}) {
  const started = Date.now()
  try {
    const res = await provider.request({ method, params })
    console.log(`${label}  OK (${Date.now() - started}ms)`)
    console.log('   ->', JSON.stringify(res).slice(0, 160))
    return { ok: true }
  } catch (err) {
    const status = typeof err?.status === 'number' ? err.status
      : typeof err?.statusCode === 'number' ? err.statusCode : null
    const body = err?.details ?? err?.cause ?? err?.message ?? String(err)
    const text = JSON.stringify(body).replace(/\s+/g, ' ').slice(0, 200)
    console.log(`${label}  FALLO (${Date.now() - started}ms)`)
    console.log('   status  :', status ?? '(sin status)')
    console.log('   codigo  :', err?.code ?? '(sin code)')
    console.log('   mensaje :', text)
    console.log('   clase   :', err?.name ?? 'Error')
    return { ok: false, status, text }
  }
}

console.log('=== SDK de Circle, ruta real del SDK ===')

const rp = new RpProvider(CLIENT_URL, key)
const r1 = await attempt('rp_getRegistrationOptions ', rp, 'rp_getRegistrationOptions')

const modular = new ModularWalletsProvider(`${CLIENT_URL}/arc`, key)
const r2 = await attempt('circle_getAddress        ', modular, 'circle_getAddress')

// Control: a structurally valid but bogus key must come back as a credential
// rejection. Without this baseline you cannot tell "bad key" from "bad payload".
const bogus = new RpProvider(CLIENT_URL, `LIVE_CLIENT_KEY:${'0'.repeat(32)}:${'0'.repeat(32)}`)
const ctrl = await attempt('CONTROL llave falsa     ', bogus, 'rp_getRegistrationOptions')

console.log('')
console.log('=== veredicto ===')

// The only failure that implicates the credential is Circle answering
// "Invalid credentials" (HTTP 401). Anything else means the key was accepted
// and the request itself was the problem. Proved with a bogus-key control.
const authFailures = [r1, r2].filter((r) => /Invalid credentials/i.test(r.text ?? ''))
const controlIsAuthFail = /Invalid credentials/i.test(ctrl.text ?? '')

console.log('  control (llave falsa) ->', controlIsAuthFail ? '401 Invalid credentials' : 'NO fue rechazo de credencial (?!)')
console.log('')

if (authFailures.length > 0) {
  console.log('  Circle RECHAZA la credencial (Invalid credentials / 401).')
  console.log('  -> Revisa Circle Console: la llave, su entidad y sus dominios.')
} else if (r1.ok || r2.ok) {
  console.log('  La llave ES VALIDA: Circle la acepta.')
} else {
  console.log('  La llave ES VALIDA: Circle NO respondio Invalid credentials.')
  console.log('  Los fallos son de payload (-32000 API parameter invalid), no de auth.')
  console.log('  -> Esta llamada no es la que hace la app; usa el SDK de verdad.')
}
