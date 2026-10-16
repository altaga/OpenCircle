# OpenCircle USDC Wallet — Security Audit Report

**Audit Date:** 2025-07-15  
**Target Chain:** Arc Testnet (chain ID 5042002)  
**Severity Level:** Max  
**Auditor:** Arc Studio Security Research (max preset)  
**Scope:** Frontend-only React/TypeScript wallet application  

---

## Files Audited

| File | Purpose |
|---|---|
| `src/hooks/useCircleWallet.ts` | Passkey-based Modular Wallet hook (ERC-4337 MSCA) |
| `src/hooks/useUsdcBalance.ts` | USDC balance polling |
| `src/components/WalletSetup.tsx` | Passkey registration/login UI |
| `src/components/SendPanel.tsx` | Send USDC |
| `src/components/ReceivePanel.tsx` | Receive USDC / display address |
| `src/components/SwapPanel.tsx` | Swap tokens to USDC via Circle AppKit |
| `src/components/BridgePanel.tsx` | Bridge USDC across chains via Circle AppKit CCTP |
| `src/App.tsx` | Main app composition |
| `src/main.tsx` | Root React entry point |
| `src/config.ts` | wagmi configuration |
| `src/tracing.ts` | Fetch/EIP-1193 tracing instrumentation |
| `src/console-capture.ts` | Console log forwarding instrumentation |
| `src/onchain-facts.ts` | Chain/token registry |
| `src/onchain-money.ts` | USDC amount math library |
| `vite.config.ts` | Vite build/server config |
| `index.html` | HTML entry point |
| `package.json` | Dependency manifest |
| `.env` | Environment variables |

---

## Executive Summary

| Severity | Count |
|---|---|
| **Critical** | 2 |
| **High** | 5 |
| **Medium** | 7 |
| **Low** | 6 |
| **Info** | 5 |
| **Total** | 25 |

The app is well-structured for a testnet wallet and uses Circle's infrastructure correctly in most areas. The most serious issues are (1) the `sessionStorage` credential store being fully XSS-readable with no integrity check, which enables silent account takeover; and (2) no upper-bound amount validation in `sendUsdc`, which allows a floating-point string like `"1e18"` to survive the UI guard and cause `parseUnitsExact` to throw a confusing `TOO_MANY_FRACTION_DIGITS` error instead of a safe rejection. Several medium-severity issues relate to missing security headers, the Vite dev-server CORS wildcard, the tracing instrumentation forwarding full RPC request bodies (including `userOperation` callData) to the parent frame, and the `retryBridge` button having no execution guard against rapid repeated taps.

---

## Findings

---

### CRIT-01 — Credential integrity not verified on session restore

**Severity:** Critical  
**Location:** `src/hooks/useCircleWallet.ts`, lines 83–103 (session restore `useEffect`)  

**Description:**  
On mount, the hook reads `oc_credential` from `sessionStorage` with `JSON.parse` and immediately derives the smart-account address from it without verifying that the deserialized object is a genuine `WebAuthnCredential` from Circle's passkey transport. An attacker with any XSS foothold on the same origin can write arbitrary JSON into `sessionStorage.oc_credential` before the app loads. If the crafted object happens to satisfy TypeScript's structural duck-typing (it just needs `id` and `publicKey` fields to pass the `toP256` cast), `toCircleSmartAccount` will happily derive a wallet address for attacker-controlled credentials. The victim then sees a "ready" wallet state they believe is theirs while they are actually operating under the attacker's credential object.

Even without full account takeover, the attacker can inject a near-valid object that causes `setState('ready')` while the `address` derived differs from the user's real smart-account address — causing the displayed balance to show zero, blocking legitimate sends, and creating confusion that could be exploited for a social-engineering follow-on attack.

**Root cause:** No structural or cryptographic validation of the `oc_credential` payload after `JSON.parse`. The raw parsed object is cast to `WebAuthnCredential` unconditionally, and `toCircleSmartAccount` accepts whatever `owner` it receives.

**Recommended fix:**
```typescript
// After JSON.parse, validate the minimum required shape:
function isValidCredentialShape(obj: unknown): obj is WebAuthnCredential {
  if (typeof obj !== 'object' || obj === null) return false
  const c = obj as Record<string, unknown>
  return (
    typeof c.id === 'string' && c.id.length > 0 &&
    typeof c.publicKey === 'string' && c.publicKey.length > 0
  )
}

const raw = sessionStorage.getItem(SESSION_KEY)
if (!raw) return
let parsed: unknown
try { parsed = JSON.parse(raw) } catch { sessionStorage.removeItem(SESSION_KEY); return }
if (!isValidCredentialShape(parsed)) {
  sessionStorage.removeItem(SESSION_KEY)
  return
}
```
For production, migrate to a server-issued httpOnly session token that references a server-side credential record, eliminating client-side credential storage entirely. If sessionStorage must be used, additionally store a HMAC of the credential JSON keyed by a value that cannot be read by XSS (e.g. a randomly-seeded value stored in a `__Host-` cookie with `SameSite=Strict`) and verify it on restore.

---

### CRIT-02 — `sendUsdc` amount validation accepts scientific notation and unbounded decimals

**Severity:** Critical  
**Location:** `src/hooks/useCircleWallet.ts`, lines 166–167; `src/components/SendPanel.tsx`, line 28  

**Description:**  
`sendUsdc` validates the amount using `parseFloat(amountUsd)` and a `> 0` check:
```typescript
const parsed = parseFloat(amountUsd)
if (isNaN(parsed) || parsed <= 0) throw new Error('Invalid amount')
```
`parseFloat("1e18")` returns `1e18` (a valid positive float), so `"1e18"` passes this guard. `parseUsdc("1e18")` subsequently calls `parseUnitsExact("1e18", 6)`, which correctly rejects it as "not a plain decimal number" — but this surfaces as an opaque runtime error thrown out of the signing flow rather than a clean pre-flight rejection. Worse, the HTML `<input type="number">` in `SendPanel` will freely emit `"1e18"` when the user types it (browsers allow scientific notation in `type="number"` inputs), and `SendPanel`'s own `amountValid` guard (`parseFloat(amount) > 0`) passes it through to `onSend`.

A second vector: the UI allows `"0.0000001"` (7 decimal places) to be submitted. `parseUsdc` will throw `TOO_MANY_FRACTION_DIGITS` mid-flow — after the wallet is already in `'signing'` state — leaving `txState` stuck at `'error'` with a confusing internal error message exposed in the UI.

There is no upper-bound check. A user can type `999999999999` and the UI will not warn them before signing. On a testnet this is harmless, but the pattern is dangerous for any production fork of this code.

**Recommended fix:**
```typescript
// In useCircleWallet.ts sendUsdc, replace the float guard:
const DECIMAL_AMOUNT_RE = /^\d+(\.\d{1,6})?$/
if (!DECIMAL_AMOUNT_RE.test(amountUsd.trim())) throw new Error('Invalid amount format')
const parsed = parseFloat(amountUsd)
if (isNaN(parsed) || parsed <= 0) throw new Error('Amount must be greater than zero')
// Optionally add a sanity upper bound:
if (parsed > 1_000_000) throw new Error('Amount too large')

// In SendPanel.tsx, tighten amountValid:
const amountValid = /^\d+(\.\d{1,6})?$/.test(amount) && parseFloat(amount) > 0
```
This ensures scientific notation, too many decimal places, and out-of-range values are caught at the UI layer before any signing state change.

---

### HIGH-01 — `VITE_CLIENT_KEY` is exposed to the browser bundle

**Severity:** High  
**Location:** `src/hooks/useCircleWallet.ts`, line 31; `src/hooks/useUsdcBalance.ts`, line 16  

**Description:**  
```typescript
const CLIENT_KEY = import.meta.env.VITE_CLIENT_KEY as string
```
Any environment variable prefixed with `VITE_` is inlined verbatim into the JavaScript bundle by Vite at build time. Anyone who opens DevTools, fetches the built JS asset, or uses a source-map viewer can read the raw `CLIENT_KEY` value. This key is passed to `toPasskeyTransport` and `toModularTransport` as a bearer credential for Circle's Modular SDK API.

From the `.env` file, `VITE_CLIENT_KEY` is currently empty in the sandbox, but the pattern is dangerous and will be populated in any real deployment. An extracted key could be used to:
- Enumerate or interact with Circle's Modular SDK API at the attacker's expense/quota;
- Potentially enumerate registered usernames or credentials depending on Circle's API scoping;
- Spoof app identity if the key authenticates the calling origin.

This is an architectural constraint of browser-first SDK designs (there is no secret that can be truly hidden on the client), but the exposure level can be significantly reduced.

**Recommended fix:**
- Treat `VITE_CLIENT_KEY` as a **public, scoped, rate-limited** API key — document this assumption explicitly in the codebase.
- Enforce strict **origin allow-listing** and **rate limiting** on the Circle dashboard for this key so an extracted key cannot be abused from an arbitrary origin.
- Do NOT use the same key for any server-side or privileged operation.
- If Circle's SDK supports an **origin-restricted** key type (similar to Google Maps' browser key restrictions), configure that.
- Consider adding a thin server-side proxy that injects the key server-side, removing it from the browser bundle entirely.

---

### HIGH-02 — Vite dev server has `cors: true` (wildcard CORS) and `allowedHosts: true`

**Severity:** High  
**Location:** `vite.config.ts`, lines 38–39  

**Description:**  
```typescript
server: {
  allowedHosts: true,
  cors: true,
},
```
`cors: true` is equivalent to `Access-Control-Allow-Origin: *` for every response from the dev server. Combined with `allowedHosts: true` (which allows any `Host` header value, disabling the Host header check that prevents DNS rebinding attacks), this configuration is a **DNS rebinding** attack surface. An attacker who can make the victim's browser perform a DNS rebinding attack against the local dev server can read any response, including the Vite HMR WebSocket which carries the full application source code.

In production (built output) CORS and host restrictions are controlled by the serving infrastructure, not Vite. However, this configuration is committed to the repository and is applied to any developer running `bun run dev`, which may include CI pipelines and developer machines on shared networks.

**Recommended fix:**  
```typescript
server: {
  // Only allow the specific preview host; never use `true` in committed config
  allowedHosts: ['localhost', '127.0.0.1'],
  cors: {
    origin: process.env.VITE_ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:5173'],
    credentials: true,
  },
},
```
If this config is required for Arc Studio's preview infrastructure specifically (the sandbox embeds the app in an iframe from a different origin), document that clearly and scope the wildcard override to the CI/preview environment only, not the developer machine.

---

### HIGH-03 — `txState` machine allows double-tap / double-execution of `sendUsdc`

**Severity:** High  
**Location:** `src/components/SendPanel.tsx`, line 29; `src/hooks/useCircleWallet.ts`, line 169  

**Description:**  
`SendPanel`'s send button guard is:
```typescript
const canSend = addressValid && amountValid && txState === 'idle'
```
This correctly disables the button while `txState !== 'idle'`. However, the guard is evaluated in the component's render cycle, which is asynchronous. If two rapid successive button taps arrive before React re-renders with the new `txState` (i.e., before the first `setTxState('signing')` call propagates), both taps can invoke `onSend` with the same parameters. Since `sendUsdc` in the hook does not carry its own mutex or "in-flight" guard (it only reads the current state, which has not been committed yet), both calls can race through to `bundlerClient.sendUserOperation` and submit two separate UserOperations to the bundler.

On a ERC-4337 account, two UserOperations with the same nonce will result in one reverting, but if the bundler assigns sequential nonces, both can succeed — resulting in the user sending the amount twice.

**Recommended fix:**
```typescript
// In useCircleWallet.ts, guard against concurrent execution:
const sendingRef = useRef(false)

const sendUsdc = useCallback(async (to: Hex, amountUsd: string): Promise<string> => {
  if (sendingRef.current) throw new Error('Transaction already in progress')
  sendingRef.current = true
  // ...existing logic...
  try {
    // ...
  } finally {
    sendingRef.current = false
  }
}, [credential, address])
```
A `useRef`-based mutex is the correct tool because it is synchronous (unlike `txState`, which only updates after a React render).

---

### HIGH-04 — `retryBridge` button has no disabled state during execution

**Severity:** High  
**Location:** `src/components/BridgePanel.tsx`, lines 247–253  

**Description:**  
The "Retry bridge" button is rendered without a `disabled` attribute:
```tsx
<button
  onClick={() => void handleRetry()}
  className="..."
  style={{ ... }}
>
  Retry bridge
</button>
```
The regular bridge button correctly disables itself with `disabled={sameChain || !amount || phase === 'bridging'}`, but the retry button omits this. A user who is frustrated with a slow bridge can repeatedly tap "Retry bridge", triggering multiple concurrent `kit.retryBridge` calls against the same `lastResult.current` object. CCTP's `retryBridge` is designed to be idempotent where possible, but concurrent invocations sharing a mutable `lastResult.current` reference can produce inconsistent step state, and if the retry itself triggers on-chain activity (e.g. re-minting), concurrent calls could result in duplicated operations at the network level.

**Recommended fix:**
```tsx
<button
  disabled={phase === 'bridging'}
  onClick={() => void handleRetry()}
  ...
>
  {phase === 'bridging' ? (
    <><Loader2 size={16} className="animate-spin" /> Retrying…</>
  ) : (
    'Retry bridge'
  )}
</button>
```
Match the main bridge button's disabled-during-bridging pattern exactly.

---

### HIGH-05 — `txError` is rendered as raw string from Error objects without sanitization

**Severity:** High  
**Location:** `src/components/SendPanel.tsx`, line 157; `src/components/SwapPanel.tsx`, line 269; `src/components/BridgePanel.tsx`, line 306  

**Description:**  
Error messages from the Circle SDK, the bundler RPC, and the swap/bridge kit are rendered directly into the DOM via:
```tsx
<p className="text-sm" style={{ color: 'var(--danger)' }}>{txError}</p>
<p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
```
React escapes HTML in JSX text content, so this is NOT a classic stored XSS vector in the current React rendering path — React's JSX text escaping prevents `<script>` injection here. However, there is a related concern: error messages from external services (RPC nodes, Circle's APIs, third-party bridging infrastructure like LiFi) may include:
- Wallet addresses or ENS names that the user did not input (correlation/privacy leak)
- Internal API error codes or stack traces that reveal infrastructure details
- URLs that, if combined with `dangerouslySetInnerHTML`, would be XSS vectors in future code changes

The current code also sets `txError` from any `Error.message` string without truncation:
```typescript
const msg = err instanceof Error ? err.message : String(err)
setTxError(msg)
```
A malicious RPC node or compromised third-party API could return an arbitrarily long error string that floods the UI.

**Recommended fix:**  
Truncate error messages before storing in state, and strip any URL-like content when displaying to users:
```typescript
const MAX_ERROR_LEN = 200
const msg = err instanceof Error ? err.message : String(err)
setTxError(msg.slice(0, MAX_ERROR_LEN))
```
Consider mapping known Circle SDK error codes to user-friendly messages rather than displaying raw SDK error strings.

---

### MED-01 — No `X-Frame-Options` / `Content-Security-Policy` headers in the built app

**Severity:** Medium  
**Location:** `vite.config.ts` (no security headers plugin configured), `index.html` (no `<meta http-equiv="Content-Security-Policy">`)  

**Description:**  
The built application ships no HTTP security headers. In particular:
- **No `X-Frame-Options: DENY`** or **`Content-Security-Policy: frame-ancestors 'none'`**: The wallet can be embedded in a hostile iframe, enabling clickjacking attacks where an attacker overlays a transparent iframe of the wallet over a deceptive UI. A user tricked into clicking a "Play" button could instead be confirming a transaction in the wallet beneath.
- **No `Content-Security-Policy`**: Without a CSP, any injected script (from a compromised CDN, a malicious browser extension, or an XSS vector in an error message rendered via `dangerouslySetInnerHTML`) can freely access `sessionStorage`, the wallet state, and `window.ethereum`.
- **No `X-Content-Type-Options: nosniff`**: Allows MIME-type sniffing attacks.
- **No `Referrer-Policy`**: The wallet's URL (which may include query parameters) is leaked to all outbound links (the explorer URL opened from `SendPanel` and `SwapPanel`).

The app loads fonts from `fonts.googleapis.com` with no SRI and no CSP to restrict external resource loading.

**Recommended fix (Vite plugin — applies to dev preview):**
```typescript
// vite.config.ts
import { defineConfig } from 'vite'

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",  // wasm for some wallet SDKs
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' https://modular-sdk.circle.com wss://modular-sdk.circle.com https://rpc.testnet.arc.io",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ')

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills(),
    {
      name: 'security-headers',
      configureServer(server) {
        server.middlewares.use((_req, res, next) => {
          res.setHeader('Content-Security-Policy', CSP)
          res.setHeader('X-Content-Type-Options', 'nosniff')
          res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
          next()
        })
      },
    },
  ],
  // ...
})
```
For production deployment (Vercel, Netlify, etc.), configure security headers in the hosting provider's config file (`vercel.json`, `netlify.toml`, or an `_headers` file). `frame-ancestors 'none'` in CSP is stronger and more modern than `X-Frame-Options: DENY`.

---

### MED-02 — `tracing.ts` forwards full RPC request/response bodies (including UserOp callData) to parent frame

**Severity:** Medium  
**Location:** `src/tracing.ts`, lines 364, 388, 405, 408  

**Description:**  
The tracing instrumentation captures the full body of every `fetch` request/response and forwards it to `window.parent` via `postMessage`:
```typescript
if (init?.body) reqBody = tryJson(truncate(typeof init.body === 'string' ? init.body : stringify(init.body)))
// ...
resBody = tryJson(truncate(await res.clone().text()))
// ...
emitWithGroups({ kind: 'http', ..., requestBody: reqBody, responseBody: resBody })
```
For RPC calls (`eth_sendUserOperation`, `eth_getUserOperationByHash`), these bodies include:
- The full `UserOperation` struct including `callData` (encodes the recipient address and USDC amount of every send)
- `paymasterAndData` (could expose paymaster nonces or policies)
- For Circle Modular SDK calls: registration blobs, credential assertions, and account metadata

This data is sent to `window.parent`, which in the Arc Studio sandbox is a trusted parent frame. However:
1. If the app is deployed outside Arc Studio, `_parentOrigin` falls back to `'*'`, meaning the trace events are broadcast to **any** parent frame that embeds the app — a trivial data exfiltration path for a clickjack attacker.
2. Even within Arc Studio, forwarding `eth_sign`-style payloads to the parent normalizes a data channel that malicious browser extensions could intercept.

The `postMessage` to `'*'` fallback is the critical case:
```typescript
const _parentOrigin: string = (() => {
  // ... tries ancestorOrigins, then referrer ...
  return '*';  // fallback
})()

function send(entry: ConsoleLogEntry): void {
  window.parent.postMessage({ type: MESSAGE_TYPE, entry }, _parentOrigin);
}
```

**Recommended fix:**
- Add a `VITE_TRACING_ENABLED` env flag and disable tracing instrumentation entirely in production builds: `if (import.meta.env.PROD && !import.meta.env.VITE_TRACING_ENABLED) return`.
- When tracing is active, strip sensitive RPC method params before forwarding: redact `eth_sendUserOperation` params, `eth_sign`, `personal_sign`, `eth_signTypedData*`.
- Never use `'*'` as the target origin for `postMessage` from a financial app. If the parent origin cannot be determined, drop the message rather than broadcast it.

---

### MED-03 — `parseFloat` used for amount validation in two separate layers with different semantics

**Severity:** Medium  
**Location:** `src/hooks/useCircleWallet.ts`, line 166; `src/components/SendPanel.tsx`, line 28; `src/components/BridgePanel.tsx`, line 72; `src/components/SwapPanel.tsx`, line 57  

**Description:**  
The codebase uses `parseFloat` in multiple places as the first amount validation gate, then `parseUsdc` (which calls `parseUnitsExact`) as the second. These two functions have fundamentally different semantics:

| Input | `parseFloat` result | `parseUnitsExact` result |
|---|---|---|
| `"1e6"` | `1000000` (valid) | throws `INVALID_NUMBER` |
| `"1.0000001"` | `1.0000001` (valid) | throws `TOO_MANY_FRACTION_DIGITS` |
| `" 1.5 "` | `1.5` (valid) | valid (trims) |
| `"Infinity"` | `Infinity` (valid float) | throws `INVALID_NUMBER` |
| `"1_000"` | `NaN` | throws `INVALID_NUMBER` |
| `".5"` | `0.5` (valid) | valid |

The discrepancy means inputs like `"1e6"` or `"Infinity"` pass the `isNaN` / `> 0` guard and are only caught deep in `parseUnitsExact` mid-transaction, after state mutations (`setTxState('signing')`) have already occurred. This leaves the UI in an inconsistent state with an unhelpful error message from the math library rather than a clean "invalid amount" user-facing error.

In `BridgePanel` and `SwapPanel`, amounts are passed as raw strings directly to `kit.bridge({ amount })` and `kit.estimateSwap({ amountIn })` — neither of which goes through `parseUsdc` at all. This means for bridge/swap amounts, there is no decimal-precision guard whatsoever; the kit's own parser handles it.

**Recommended fix:**  
Unify amount validation behind a single validation function that covers all cases before any state change:
```typescript
export function validateUsdcAmount(raw: string): { valid: false; error: string } | { valid: true; parsed: bigint } {
  const trimmed = raw.trim()
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return { valid: false, error: 'Enter a valid amount (e.g. 1.50)' }
  const f = parseFloat(trimmed)
  if (f <= 0) return { valid: false, error: 'Amount must be greater than zero' }
  if (f > 1_000_000) return { valid: false, error: 'Amount too large' }
  return { valid: true, parsed: parseUsdc(trimmed) }
}
```

---

### MED-04 — Wallet address displayed in `ReceivePanel` has no ENS/checksum verification

**Severity:** Medium  
**Location:** `src/components/ReceivePanel.tsx`, lines 23, 77  

**Description:**  
The wallet address is displayed raw and also used to generate a deterministic color-grid "visual fingerprint":
```typescript
const segments = address.slice(2).match(/.{1,4}/g) ?? []
```
The address shown is `wallet.address ?? '0x'` (from `App.tsx` line 118 and `useCircleWallet.ts` line 200). When the wallet is in the `'ready'` state, `address` is a real 42-character hex string. However, if the wallet hook returns `'0x'` (the fallback for a null address — e.g., during the brief async window when session restore is running but not yet complete), the visual fingerprint renders with only an empty segments array, but the address `'0x'` is still copyable via the "Copy address" button.

A user copy-pasting `'0x'` as their receive address and sharing it would result in funds sent to the zero address (burned). While the `wallet.state !== 'ready'` guard in `App.tsx` should prevent `ReceivePanel` from rendering in that case, there is a TOCTOU window: the guard is evaluated at render time, but the address value is derived from `wallet.address` which could theoretically be `'0x'` for a brief moment if state updates race.

Additionally, the address is not displayed in EIP-55 checksum format. Mixed-case checksummed addresses are a critical UX safety feature for crypto wallets — they allow users and external services to catch single-character transcription errors.

**Recommended fix:**
```typescript
// In ReceivePanel, guard against the '0x' fallback:
if (!address || address === '0x' || address.length !== 42) {
  return <div>Loading wallet address…</div>
}

// Display checksum address using viem:
import { getAddress } from 'viem'
const checksumAddress = getAddress(address)
```
Also, do not render `ReceivePanel` at all until `wallet.state === 'ready'` AND `wallet.address.length === 42` are both true.

---

### MED-05 — Chain ID not verified before signing in `sendUsdc`

**Severity:** Medium  
**Location:** `src/hooks/useCircleWallet.ts`, lines 172–187  

**Description:**  
`sendUsdc` calls `toCircleSmartAccount` and `bundlerClient.sendUserOperation` without first verifying that the active network matches Arc Testnet (chain ID 5042002). Both `publicClient` and `bundlerClient` are module-level constants hardcoded to `arcTestnet`, so they will refuse connections to other chains. However, if Circle's Modular SDK transport is ever updated to support multi-chain routing, or if the `CLIENT_URL` points to a routing proxy, there is no application-layer guard.

More concretely: the hook does not emit a chain-mismatch error if the user connects a wagmi wallet on a different chain and then somehow triggers `sendUsdc` (though the current UI does not bridge the wagmi-connected wallet to `sendUsdc`, the mix of two wallet contexts in the same app is itself a latent confusion risk).

**Recommended fix:**
```typescript
// At the start of sendUsdc, assert the chain explicitly:
const network = await publicClient.getChainId()
if (network !== arcTestnet.id) {
  throw new Error(`Wrong network: expected Arc Testnet (${arcTestnet.id}), connected to ${network}`)
}
```

---

### MED-06 — `username` in `WalletSetup` has no server-side equivalent sanitization or collision guard

**Severity:** Medium  
**Location:** `src/components/WalletSetup.tsx`, lines 78–79, 95  

**Description:**  
The `username` field has only a client-side `maxLength={64}` HTML attribute. There is:
- No pattern restriction (any Unicode, emoji, or special characters are accepted)
- No uniqueness check before calling `toWebAuthnCredential`
- No length enforcement on the JavaScript side (the `maxLength` HTML attribute can be bypassed with `document.querySelector('input').removeAttribute('maxLength')` or by programmatic access)

If Circle's passkey registration endpoint accepts arbitrary Unicode usernames, a username like `<script>alert(1)</script>` or a zero-width-space homograph of another user's name could be registered. The username is stored in `sessionStorage` (where it is not currently re-read after registration, so this is not a stored XSS in this app), but it is passed to Circle's backend and may appear in Circle's dashboard, emails, or future features.

More critically for user safety: a homograph username attack where an attacker registers `аlice` (Cyrillic "а") to impersonate `alice` could confuse users examining their Circle account.

**Recommended fix:**
```typescript
const USERNAME_RE = /^[a-zA-Z0-9_\-\.]{1,64}$/
const handleRegister = (username: string) => {
  if (!USERNAME_RE.test(username)) {
    // Show validation error
    return
  }
  onRegister(username)
}
```
Enforce this in both the UI (`pattern` attribute on the input) and in JavaScript before calling `onRegister`.

---

### MED-07 — `SwapPanel` missing explicit USDC→NATIVE swap block for Arc

**Severity:** Medium  
**Location:** `src/components/SwapPanel.tsx`, lines 23–24  

**Description:**  
The audit requested verification that the app correctly blocks USDC ↔ NATIVE swaps on Arc (where the gas token IS USDC at 18 decimals, making such a "swap" a no-op that would be misrepresented as a token exchange). The `SwapPanel` blocks this partially by only offering an outbound list of `['USDT', 'EURC', 'DAI', 'WETH']` (no NATIVE in the `tokenIn` list) and hardcoding `tokenOut = 'USDC'`. This means the USDC→NATIVE direction is fully blocked.

However, there is no explicit guard or error message explaining *why* these pairs are offered. The `TOKENS_IN` list is a compile-time constant with no runtime validation against the connected chain. If the chain changes (e.g., a future multi-chain version of this panel), the token list would not update automatically and could silently present invalid pairs.

Additionally, the `AppKit` instance at module level (`const kit = new AppKit()`) is shared across all `SwapPanel` renders. If `AppKit` carries any internal nonce or idempotency state from a prior swap that failed, a new swap call on the same instance could inherit stale state. This is unlikely given typical SDK design, but worth noting.

**Recommended fix:**
- Add a comment explaining why NATIVE and USDC are absent from `TOKENS_IN`: `// NATIVE excluded: on Arc, native gas = USDC (18 dec ERC-20) — swap is a no-op`
- Add a runtime assertion that `tokenIn !== 'USDC'` and `tokenIn !== 'NATIVE'` before calling `kit.estimateSwap`, to guard against future list changes.
- Consider whether a new `AppKit()` instance should be created per-operation rather than at module level, to avoid shared state between operations.

---

### LOW-01 — `useUsdcBalance` silently swallows all errors

**Severity:** Low  
**Location:** `src/hooks/useUsdcBalance.ts`, lines 46–48  

**Description:**  
The balance polling catch block is:
```typescript
} catch {
  // non-fatal; keep last known value
}
```
This suppresses all errors from `publicClient.readContract` including:
- Network failures
- RPC node returning an error (potentially indicating the app is connected to the wrong RPC)
- Wrong USDC contract address causing a revert
- Rate limiting on the Circle Modular SDK API

A user who loses RPC connectivity will silently see a stale balance with no indication that the displayed value is not current. This can lead to users making send decisions based on stale balance data.

**Recommended fix:**
```typescript
const [error, setError] = useState<string | null>(null)

// In the catch:
} catch (err) {
  const msg = err instanceof Error ? err.message : 'Balance fetch failed'
  setError(msg)
  // Keep last known value, but expose the error
}

// In the return:
return { raw, display, loading, error, refresh }
```
Expose `error` from the hook and display a subtle "Balance may be stale" indicator in `BalanceCard` when `error` is non-null.

---

### LOW-02 — No "Send to self" / "Send to zero address" guard

**Severity:** Low  
**Location:** `src/components/SendPanel.tsx`, lines 27–29; `src/hooks/useCircleWallet.ts`, line 165  

**Description:**  
The address validation only checks the regex format (`/^0x[0-9a-fA-F]{40}$/`). It does not block:
- `0x0000000000000000000000000000000000000000` (zero address — burns USDC permanently)
- The sender's own wallet address (send-to-self, wastes gas)
- `0xdead000000000000000000000000000000000000` and other well-known burn addresses

For a testnet wallet these are annoyances, not catastrophes, but the pattern is dangerous if this code is adapted for production.

**Recommended fix:**
```typescript
const BURN_ADDRESSES = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
])

if (BURN_ADDRESSES.has(to.toLowerCase())) {
  throw new Error('Cannot send to the zero/burn address')
}
if (address && to.toLowerCase() === address.toLowerCase()) {
  throw new Error('Cannot send to your own address')
}
```

---

### LOW-03 — `ReceivePanel` QR code is a placeholder with no scannable data

**Severity:** Low  
**Location:** `src/components/ReceivePanel.tsx`, lines 40–57  

**Description:**  
The "QR code" display in `ReceivePanel` is a decorative colored-dot grid derived from the address bytes — it is not a real QR code. The UI says "Scan not available in preview", but there is no production path that generates a real QR code. A user who attempts to receive funds by having the sender scan the displayed graphic will fail silently — the "QR code" encodes no machine-readable data.

For a wallet, this is a significant usability and safety issue: users trust QR codes to accurately represent addresses. A decorative non-QR display that visually resembles a QR code and sits next to a "scan" icon creates a false expectation.

**Recommended fix:**  
Either remove the QR visual entirely and display a clearly labeled "QR code coming soon" placeholder, or integrate a real QR code library (e.g., `qrcode`, `qrcode.react`) that encodes the address as a proper EIP-681 URI: `ethereum:0x...@5042002`.

---

### LOW-04 — `buildTxExplorerUrl` / `buildAddressExplorerUrl` do not sanitize their inputs

**Severity:** Low  
**Location:** `src/onchain-facts.ts`, lines 611–616  

**Description:**  
```typescript
export function buildTxExplorerUrl(chainId: number, txHash: string): string {
  return requireChain(chainId).explorerBase + '/tx/' + txHash
}
```
`txHash` is appended directly to the URL string without validation. If `txHash` ever contains characters like `?`, `#`, or URL-encoded injections (e.g., `0xabc%2F..%2Fetc%2Fpasswd`), the resulting URL could be a path traversal attempt against the explorer domain. While React's `href` attribute does not allow `javascript:` URIs (it strips them), a malformed hash could produce an unexpected redirect.

In practice, `txHash` comes from `bundlerClient.waitForUserOperationReceipt()` (a trusted SDK response), but error cases or future code changes could introduce an untrusted string.

**Recommended fix:**
```typescript
export function buildTxExplorerUrl(chainId: number, txHash: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('Invalid tx hash')
  return requireChain(chainId).explorerBase + '/tx/' + txHash
}
```

---

### LOW-05 — Module-level transport and client instances initialized without `CLIENT_KEY` guard

**Severity:** Low  
**Location:** `src/hooks/useCircleWallet.ts`, lines 37–48; `src/hooks/useUsdcBalance.ts`, lines 20–21  

**Description:**  
```typescript
const CLIENT_KEY = import.meta.env.VITE_CLIENT_KEY as string  // may be undefined/empty
const passkeyTransport = toPasskeyTransport(CLIENT_URL, CLIENT_KEY)
const modularTransport = toModularTransport(`${CLIENT_URL}${CHAIN_PATH}`, CLIENT_KEY)
const publicClient = createPublicClient({ chain: arcTestnet, transport: modularTransport })
const bundlerClient = createBundlerClient({ chain: arcTestnet, transport: modularTransport })
```
These are module-level constants instantiated at import time (before any React render). If `VITE_CLIENT_KEY` is empty or undefined (as it is in the `.env` file), the transports are created with an empty string key. The SDK may silently accept this and fail later with an opaque authentication error, rather than failing immediately with a clear "misconfiguration" error.

**Recommended fix:**
```typescript
const CLIENT_KEY = import.meta.env.VITE_CLIENT_KEY as string
if (!CLIENT_KEY) {
  throw new Error(
    '[OpenCircle] VITE_CLIENT_KEY is not set. Add it to your .env file. ' +
    'Get a key from the Circle Developer Console.'
  )
}
```
This produces a clear developer-facing error at startup instead of a mysterious runtime failure during passkey registration.

---

### LOW-06 — `logout` does not clear `txState` / `txHash` / `txError` race window

**Severity:** Low  
**Location:** `src/hooks/useCircleWallet.ts`, lines 153–160  

**Description:**  
```typescript
const logout = useCallback(() => {
  sessionStorage.removeItem(SESSION_KEY)
  setCredential(null)
  setAddress(null)
  setState('idle')
  setTxHash(null)
  setTxError(null)
  // NOTE: txState is NOT reset here
}, [])
```
`txState` is not explicitly reset to `'idle'` on logout. If the user clicks "Sign out" while a transaction is in the `'signing'` or `'confirming'` state, the credential is cleared but the bundler client's in-flight `sendUserOperation` promise continues to run with a closure reference to the (now-null) credential. When the promise resolves or rejects, it calls `setTxHash`, `setTxState`, or `setTxError` on an unmounted or re-mounted component, which can cause React's "update on unmounted component" warning and, if the user immediately logs back in, display stale transaction state from the previous session.

**Recommended fix:**
```typescript
const logout = useCallback(() => {
  sessionStorage.removeItem(SESSION_KEY)
  setCredential(null)
  setAddress(null)
  setState('idle')
  setTxState('idle')   // ← add this
  setTxHash(null)
  setTxError(null)
}, [])
```
For the in-flight promise, consider using an `AbortController` or a `isMounted` ref to prevent state updates after logout.

---

### INFO-01 — `mainnet` chain included in wagmi config without explicit justification

**Severity:** Info  
**Location:** `src/config.ts`, lines 7, 16–21  

**Description:**  
```typescript
import { mainnet } from 'wagmi/chains'
export const config = createConfig({
  chains: [arcTestnet, mainnet], // mainnet needed for ENS resolution
  transports: {
    [arcTestnet.id]: http(),
    [mainnet.id]: http(),   // ENS resolution uses mainnet
  },
})
```
Ethereum mainnet is included with an unauthenticated `http()` transport (uses a default public RPC). This is documented as being for ENS resolution, but the app does not appear to use ENS anywhere in the audited components (no ENS lookups, no `useEnsName` / `useEnsAddress` hooks visible). Including mainnet silently expands the wagmi connector's scope to include the ability to sign mainnet transactions if a user connects a mainnet-configured wallet.

If ENS resolution is genuinely needed, consider using a dedicated ENS-only endpoint with an explicit flag. If it is not needed, remove mainnet from the config.

---

### INFO-02 — `console-capture.ts` and `tracing.ts` are active in production builds

**Severity:** Info  
**Location:** `src/main.tsx`, lines 13–14  

**Description:**  
```typescript
import './tracing'
import './console-capture'
```
Both instrumentation modules are imported unconditionally in `main.tsx`. In a production build, they remain active. `tracing.ts` patches `globalThis.fetch` and `window.ethereum.request()` globally. While this is useful for Arc Studio's development preview, a production deployment of this app would ship with monkey-patched fetch and Ethereum provider, which:
- Marginally degrades fetch performance (adds async overhead to every request)
- Raises red flags for security-conscious users who inspect the app's network activity
- Could interfere with other libraries that also monkey-patch `fetch` or `window.ethereum`

**Recommended fix:**
```typescript
// main.tsx
if (import.meta.env.DEV || import.meta.env.VITE_ENABLE_TRACING === 'true') {
  await import('./tracing')
  await import('./console-capture')
}
```

---

### INFO-03 — `as string` casts on `import.meta.env` variables hide undefined at runtime

**Severity:** Info  
**Location:** `src/hooks/useCircleWallet.ts`, lines 31–32; `src/hooks/useUsdcBalance.ts`, lines 16–17  

**Description:**  
```typescript
const CLIENT_KEY = import.meta.env.VITE_CLIENT_KEY as string
const CLIENT_URL = import.meta.env.VITE_CLIENT_URL as string
```
TypeScript's `as string` cast erases the fact that `import.meta.env.VITE_CLIENT_KEY` is typed as `string | undefined` (or the `ImportMeta.env` record value type). At runtime, if these variables are not set, they will be `undefined`, which becomes `"undefined"` when coerced to a string in URL concatenation, silently producing an incorrect API URL like `"https://modular-sdk.circle.com/v1/rpc/w3s/buidl/undefined"` that fails with a non-obvious error.

**Recommended fix:** See LOW-05 above for the startup guard. Also add `vite-env.d.ts` type declarations for the expected variables:
```typescript
// src/vite-env.d.ts
interface ImportMetaEnv {
  readonly VITE_CLIENT_KEY: string
  readonly VITE_CLIENT_URL: string
}
```

---

### INFO-04 — Dependency pinning uses caret ranges; supply chain risk

**Severity:** Info  
**Location:** `package.json`, all `dependencies` and `devDependencies`  

**Description:**  
All dependencies use `^` (caret) semver ranges:
```json
"@circle-fin/modular-wallets-core": "^1.0.16",
"viem": "^2.56.3",
"wagmi": "^2.19.5"
```
With `^`, `bun install` (or `npm install`) on a clean machine will always pull the latest compatible minor/patch version. If any of these packages is compromised via a supply-chain attack (malicious version published to npm), the next clean install picks it up automatically. This is a particular concern for:
- `@circle-fin/modular-wallets-core` — direct access to passkey transport and wallet signing
- `viem` — parses and encodes all transaction data
- `wagmi` — manages the injected wallet connection

The `bun.lock` lockfile pins exact versions for reproducible installs, mitigating this for builds from the locked state. However, `bun update` or a fresh `bun install` with a deleted lockfile reintroduces the risk.

**Recommended fix:**
- Pin security-critical packages to exact versions in `package.json`: `"@circle-fin/modular-wallets-core": "1.0.16"` (no `^`).
- Enable Bun's `--frozen-lockfile` flag in CI to enforce that the lockfile is never modified during CI builds.
- Integrate a supply-chain monitoring tool (e.g., Socket.dev, Snyk, or GitHub's Dependabot with security-only auto-merge) to alert on malicious package versions.

---

### INFO-05 — `buildTxExplorerUrl` result used as a raw `href` without protocol check

**Severity:** Info  
**Location:** `src/components/SendPanel.tsx`, lines 136–141; `src/components/SwapPanel.tsx`, lines 249–254  

**Description:**  
```tsx
<a href={explorerUrl} target="_blank" rel="noopener noreferrer">
  View on explorer
</a>
```
The `explorerUrl` is built from `onchain-facts.ts` which has hard-coded `https://` explorer base URLs, so in practice this is safe. However, the pattern does not enforce `https://` at the consumption site. If `buildTxExplorerUrl` were ever modified to return a `data:` or `javascript:` URL (e.g., through a future code path that accepts a user-provided explorer URL), this `href` would execute arbitrary JavaScript.

React does automatically block `javascript:` hrefs in modern versions, but `data:` URIs are not blocked and can be used for content injection in some browsers.

**Recommended fix:** Add an `isValidExplorerUrl` guard before using the URL in an `href`:
```typescript
function isSafeUrl(url: string): boolean {
  return url.startsWith('https://')
}
// In the component:
{explorerUrl && isSafeUrl(explorerUrl) && (
  <a href={explorerUrl} target="_blank" rel="noopener noreferrer">...
```

---

## Arc Testnet–Specific Findings Summary

### USDC Decimal Handling (Arc-specific)

**Arc's dual USDC representation is correctly handled.** `onchain-facts.ts` correctly documents and distinguishes:
- Native gas token: `decimals: 18`, `isUsdc: true`
- ERC-20 USDC: `address: "0x3600000000000000000000000000000000000000"`, `decimals: 6`

`onchain-money.ts` provides `usdcToGasToken` / `gasTokenToUsdc` converters with `requireGasTokenIsUsdc` guards. `parseUsdc` always uses `USDC_DECIMALS = 6`. `useCircleWallet.ts` correctly uses `ContractAddress.ArcTestnet_USDC` from the Circle SDK for the ERC-20 token address, not a hardcoded value or the native token.

**No native/ERC-20 decimal confusion was found in the transaction path.** CRIT-02 above (float pre-validation) is the only amount-handling issue, and it results in an error rather than a wrong-decimal-count silently succeeding.

### USDC ↔ NATIVE Swap Block (Arc-specific)

**The block is present but implicit.** `SwapPanel` hardcodes `TOKENS_IN = ['USDT', 'EURC', 'DAI', 'WETH']` and `TOKEN_OUT = 'USDC'`, which excludes the NATIVE token from all swap directions. This correctly prevents the no-op pair. See MED-07 for the recommendation to make this explicit in code comments and add a runtime assertion.

---

## Finding Summary

| ID | Severity | Title |
|---|---|---|
| CRIT-01 | **Critical** | Credential integrity not verified on session restore |
| CRIT-02 | **Critical** | `sendUsdc` amount validation accepts scientific notation |
| HIGH-01 | **High** | `VITE_CLIENT_KEY` exposed in browser bundle |
| HIGH-02 | **High** | Vite dev server: wildcard CORS + unrestricted hosts |
| HIGH-03 | **High** | `sendUsdc` double-tap race condition (no mutex) |
| HIGH-04 | **High** | `retryBridge` button not disabled during execution |
| HIGH-05 | **High** | Raw SDK error messages rendered without truncation |
| MED-01 | **Medium** | No `Content-Security-Policy` / clickjacking headers |
| MED-02 | **Medium** | Tracing instrumentation leaks RPC bodies to parent frame |
| MED-03 | **Medium** | `parseFloat` vs `parseUnitsExact` semantic mismatch |
| MED-04 | **Medium** | `'0x'` address fallback copyable in ReceivePanel; no checksum display |
| MED-05 | **Medium** | No chain ID assertion before signing |
| MED-06 | **Medium** | Username accepts arbitrary Unicode; no pattern restriction |
| MED-07 | **Medium** | USDC↔NATIVE swap block is implicit, no runtime guard |
| LOW-01 | **Low** | Balance poll swallows all errors silently |
| LOW-02 | **Low** | No zero address / send-to-self guard |
| LOW-03 | **Low** | QR code is decorative, not machine-readable |
| LOW-04 | **Low** | `buildTxExplorerUrl` does not sanitize `txHash` |
| LOW-05 | **Low** | Module-level transports created without `CLIENT_KEY` guard |
| LOW-06 | **Low** | `logout` does not reset `txState` |
| INFO-01 | **Info** | Mainnet chain in wagmi config without ENS usage |
| INFO-02 | **Info** | Tracing/console instrumentation active in production builds |
| INFO-03 | **Info** | `as string` cast hides undefined env vars |
| INFO-04 | **Info** | `^` semver ranges; supply chain risk |
| INFO-05 | **Info** | Explorer URL not protocol-checked at consumption site |

---

## Disclaimer

This audit was performed as a best-effort max-depth automated review of the provided source files. It is **not a substitute for a paid third-party security audit** by a specialized firm. No audit can guarantee the absence of all vulnerabilities. This report covers the frontend application logic only; the security of Circle's Modular SDK APIs, bundler infrastructure, and smart-contract implementation is out of scope.
