#!/usr/bin/env node
/**
 * check-credential — diagnose a Circle Modular SDK client key locally,
 * WITHOUT ever printing it.
 *
 * Everything this script prints is a boolean, an HTTP status, a SHA-256
 * fingerprint or a short server message. The key itself is never logged,
 * never echoed, and never written to disk.
 *
 * Usage
 *   bun run scripts/check-credential.mjs              # prompts, input is hidden
 *   bun run scripts/check-credential.mjs --compare    # two keys, prints only fingerprints
 *   bun run scripts/check-credential.mjs --file .env  # reads VITE_CLIENT_KEY_MAINNET
 *   bun run scripts/check-credential.mjs --env        # reads VITE_CLIENT_KEY_MAINNET
 *
 * Why the Origin sweep: Circle client keys can be domain-restricted. A key
 * allowed on one origin is rejected on every other domain with the same
 * opaque "Invalid credentials" that a revoked key produces. This script
 * tells those two cases apart.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'

// ── Endpoints / origins under test ───────────────────────────────────────────
const ENDPOINTS = [
  { label: 'modular /arc  ', url: 'https://modular-sdk.circle.com/v1/rpc/w3s/buidl/arc' },
  { label: 'modular /base ', url: 'https://modular-sdk.circle.com/v1/rpc/w3s/buidl' },
]

const ORIGINS = [
  { label: 'sin Origin     ', value: null },
  { label: '0xoc.netlify   ', value: 'https://0xoc.netlify.app' },
  { label: 'localhost:5173 ', value: 'http://localhost:5173' },
  { label: 'studio.arc.io  ', value: 'https://studio.arc.io' },
]

// A method Circle does not implement. Auth is checked before the method, so the
// verdict is valid, and nothing can be created, read or mutated.
const PROBE_METHOD = '__opencircle_credential_probe__'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Short, non-reversible fingerprint — lets you compare two keys safely. */
function fingerprint(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 12)
}

/** Shape only. Never prints content. */
function describe(key) {
  const parts = key.split(':')
  return {
    length: key.length,
    segments: parts.length,
    env: (/^([A-Z]+)_/.exec(key)?.[1] ?? '?').toLowerCase(),
    role: (/^[A-Z]+_([A-Z]+)_/.exec(key)?.[1] ?? '?').toLowerCase(),
    uuidPair:
      parts.length === 3 &&
      /^[0-9a-f]{32}$/i.test(parts[1] ?? '') &&
      /^[0-9a-f]{32}$/i.test(parts[2] ?? ''),
    fingerprint: fingerprint(key),
  }
}

/** Reads a line while masking every character except the return key. */
function promptHidden(label) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    const masked = new Writable({
      write(chunk, _enc, cb) {
        for (const ch of chunk.toString()) {
          if (ch === '\r' || ch === '\n') process.stdout.write(ch)
          else if (ch === '' || ch === '\b') process.stdout.write('\b \b')
          else process.stdout.write('*')
        }
        cb()
      },
    })
    rl.output = masked
    rl.question(label, (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer.trim())
    })
  })
}

function readKeyFromFile(path) {
  const text = readFileSync(path, 'utf8')
  const line = text.split(/\r?\n/).find((l) => /^\s*(export\s+)?VITE_CLIENT_KEY_MAINNET\s*=/.test(l))
  if (!line) throw new Error(`No se encontro VITE_CLIENT_KEY_MAINNET en ${path}`)
  return line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '')
}

function readKeyFromEnv() {
  const key = process.env.VITE_CLIENT_KEY_MAINNET
  if (!key) throw new Error('VITE_CLIENT_KEY_MAINNET no esta definida en el entorno')
  return key
}

/** One probe. Returns status + verdict, never the key. */
async function probe(url, key, origin) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
    'X-AppInfo': 'platform=web;diagnostic=credential-probe;uri=localhost',
  }
  if (origin) headers.Origin = origin

  const started = Date.now()
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method: PROBE_METHOD }),
      signal: AbortSignal.timeout(10_000),
    })
    const body = (await res.text()).replace(/\s+/g, ' ').trim().slice(0, 160)
    return {
      accepted: !(res.status === 401 || res.status === 403),
      status: res.status,
      body,
      ms: Date.now() - started,
    }
  } catch (err) {
    return {
      accepted: false,
      status: null,
      body: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      ms: Date.now() - started,
    }
  }
}

// ── Modes ────────────────────────────────────────────────────────────────────

async function compareMode() {
  console.log('\nCompara dos llaves sin revelar ninguna.\n')
  const a = await promptHidden('Llave A (p. ej. la de Circle Console): ')
  const b = await promptHidden('Llave B (p. ej. la de Netlify):          ')
  console.log('\n--- comparacion ---')
  const fa = fingerprint(a)
  const fb = fingerprint(b)
  console.log('A  fingerprint :', fa, JSON.stringify(describe(a)))
  console.log('B  fingerprint :', fb, JSON.stringify(describe(b)))
  console.log('SON LA MISMA   :', fa === fb ? 'SI' : 'NO   <-- revolver aqui')
  console.log('')
}

async function diagnoseMode(key) {
  console.log('\n=== 1. Que ve la app (sin revelar el valor) ===')
  console.log(JSON.stringify(describe(key), null, 2))

  console.log('\n=== 2. Peticiones a Circle ===')
  let anyAccepted = false
  let workingOrigin = null

  for (const endpoint of ENDPOINTS) {
    for (const origin of ORIGINS) {
      const r = await probe(endpoint.url, key, origin.value)
      if (r.accepted) {
        anyAccepted = true
        if (origin.value) workingOrigin = origin.label.trim()
      }
      const verdict = r.accepted ? 'AUTENTICADA' : 'RECHAZADA  '
      console.log(
        `  ${endpoint.label} ${origin.label} HTTP ${String(r.status ?? '---').padEnd(4)} ${verdict}  ${r.body.slice(0, 80)}`,
      )
    }
  }

  console.log('\n=== 3. Veredicto ===')
  if (anyAccepted) {
    console.log('  La llave ES aceptada por Circle en al menos un origen.')
    if (workingOrigin) {
      console.log(`  Solo responde con Origin: ${workingOrigin}`)
      console.log('  -> La llave esta RESTRINGIDA POR DOMINIO.')
      console.log('  Circle Console > Client Keys > allowed origins debe incluir tu dominio.')
    } else {
      console.log('  -> La falla NO es la llave. Revisa VITE_CLIENT_URL, chainPath o el SDK.')
    }
  } else {
    console.log('  La llave es RECHAZADA por Circle en todas las rutas y origenes.')
    console.log('  -> Esta revocada/expirada, o pertenece a otra entidad,')
    console.log('     o le copiaste mal el valor. No es un problema de codigo ni de build.')
  }
  console.log('')
}

// ── Entry ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

try {
  if (args.includes('--compare')) {
    await compareMode()
  } else if (args.includes('--file')) {
    const path = args[args.indexOf('--file') + 1]
    if (!path) throw new Error('Falta la ruta: --file <ruta>')
    await diagnoseMode(readKeyFromFile(path))
  } else if (args.includes('--env')) {
    await diagnoseMode(readKeyFromEnv())
  } else {
    const key = await promptHidden('Pega la llave (no se vera): ')
    if (!key) throw new Error('Llave vacia')
    await diagnoseMode(key)
  }
} catch (err) {
  console.error('\nError:', err instanceof Error ? err.message : err)
  process.exitCode = 1
}
