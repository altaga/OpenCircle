# OpenCircle

> Built with Arc Studio — money-powered apps in minutes

This is the **project memory** — what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

A self-custodial USDC wallet on **Arc Mainnet**, built end to end in Arc Studio. Users
create a smart account with a passkey (Circle Modular Wallets / WebAuthn, ERC-4337 MSCA);
there is no seed phrase and no private key ever reaches the client. **Send, Receive,
Swap, Bridge** and an **Agent** tab all live in the app.

The Agent tab is a chat assistant that can read wallet state (`get_usdc_balance`,
`get_wallet_info`) and **send USDC to a single recipient** (`send_usdc`). Every write
tool is gated twice on purpose: an in-chat confirmation card proves *intent*, and a
WebAuthn prompt proves *identity* (the same passkey that registered the wallet). The
Agent's only door to the model is a Netlify Function that holds the inference key
server-side — the browser never sees it.

---

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Wallet: **Circle Modular Wallets** — passkey (WebAuthn) signer on a Modular Smart Contract Account. Not an injected EOA; there is no seed phrase.
- Chain: **Arc Mainnet only** (Chain ID: 5042, from `viem/chains`, path `/arc`). Testnet is hard-removed, not configurable.
- Token: USDC (6 decimals), `0x3600000000000000000000000000000000000000` on Arc Mainnet
- Storage: IndexedDB primary + localStorage mirror in `src/lib/credential-store.ts` for the remembered wallet; the PWA install is the only thing that actually defeats Safari ITP
- Toasts: Sonner
- Agent: Netlify Function (`netlify/functions/agent.ts`) proxies the MiniMax Anthropic-compatible API; tool catalog in `src/lib/agent-tools-schema.ts`; browser-side execution in `src/lib/agent-tools.ts`; write tools (`send_usdc`, `swap_tokens`, `bridge_usdc`) are gated by an in-chat proposal card in addition to the WebAuthn prompt
- PWA: `vite-plugin-pwa` (`vite.config.ts`) — network-first for navigations, precaches the app shell + icons
- Contracts: Foundry (`lib/forge-std/`) for any Solidity under `contracts/`

---

## Configuration

There are **two** environment variables, with very different threat models:

| Var | Where it lives | Purpose | Treat it as |
|---|---|---|---|
| `VITE_CLIENT_KEY_MAINNET` | Client (inlined into JS bundle at build) | Circle Modular Wallets client key | **Not a secret** — designed to ship in a browser bundle. Never commit `.env`. When comparing keys, report only length, prefix, and SHA-256 fingerprint. |
| `MINIMAX_APIKEY` | Server only (Netlify Function env) | Inference key for the Agent tab | **Real secret** — deliberately *not* `VITE_*`. Vite inlines every `VITE_*` variable into the client bundle, so a `VITE_*` inference key would publish to the internet. The Function is the only place this secret is allowed. |

Everything else (chain id, chain path, USDC address, RPC URL, explorer) is a constant in
`src/lib/circle-config.ts`. `.env.example` is committed as a template (empty value) — copy
it to `.env` for local development.

## Key Files

**App shell**
- `src/App.tsx` — main composition; tab state for Send / Receive / Swap / Bridge / Agent
- `src/main.tsx` — React entry; renders the `Built with Arc Studio` watermark (do not add a second)
- `src/config.ts` — wagmi config (chains, connectors, transports); pre-registers chain RPC URLs so trace events carry the right chain names
- `src/context/NetworkContext.tsx` — Arc Mainnet-only provider; testnet path is hard-removed; this is where `clientKey` reaches the rest of the app

**Wallet (the thing that consumes Circle credentials)**
- `src/lib/circle-config.ts` — Arc Mainnet constants + the client key read
- `src/lib/credential-store.ts` — IndexedDB primary + localStorage mirror (fallback when IDB is blocked by an extension or private-mode quirk); per-tab marker in sessionStorage; structural validation via `isValidCredentialShape`; `requestPersistentStorage()` for Safari
- `src/lib/wallet-errors.ts` — maps SDK errors to actionable copy. **`scrub()` is the last line of defence, not a debug aid** — it strips the client key out of any text bound for the screen or the console. Every new error path must funnel through `friendlyWalletError`, which calls `scrub` before returning
- `src/lib/session-persistence.ts` — `lastVisit` timestamp in **localStorage** (not IDB). Deliberately on the same channel that ITP wipes, so a wipe produces `null` and triggers the warning banner
- `src/lib/wallet-reauth.ts` — WebAuthn re-auth gate. Decodes the stored base64url credential id back to bytes for `allowCredentials`, generates a 16-byte client-side challenge, returns `true` only on a successful assertion. Used before `forgetCredential` to prevent accidental wipes
- `src/lib/use-pwa-install.ts` — `usePwaInstall()` hook + `isIosSafari()` helper. Chromium `beforeinstallprompt` replay and iOS manual Share → Add to Home Screen instructions. Required to defeat Safari's 7-day eviction cap
- `src/hooks/useCircleWallet.ts` — passkey register / login / logout, MSCA address, USDC send
- `src/hooks/useUsdcBalance.ts` — polls the ERC-20 USDC balance via the Circle modular RPC
- `src/hooks/useSessionPersistence.ts` — reads `lastVisit` on mount, writes the new one, returns `{ shouldWarn, daysSinceLastVisit }` for `SessionPersistenceWarning`. Single `useEffect` pass; the write happens on every mount by design (the timestamp is the "last seen", not "last interaction")

**Panels (one per tab)**
- `src/components/WalletSetup.tsx` — passkey registration / sign-in card
- `src/components/BalanceCard.tsx` — hero balance + refresh
- `src/components/SendPanel.tsx` — send USDC
- `src/components/ReceivePanel.tsx` — display address + QR
- `src/components/SwapPanel.tsx` — swap tokens to USDC via Circle AppKit
- `src/components/BridgePanel.tsx` — bridge USDC across chains via Circle AppKit CCTP
- `src/components/AgentPanel.tsx` — chat surface; thinking toggle; tool trace under each reply
- `src/components/InstallBanner.tsx` — surfaced inside the app; uses `usePwaInstall`
- `src/components/SessionPersistenceWarning.tsx` — "your wallet could be cleared" banner; surfaces when `lastVisit` is older than 5 days and the PWA is not installed
- `src/components/SplashScreen.tsx` — full-screen loader held while IndexedDB is consulted
- `src/components/Logo.tsx` — `LogoFull` / `LogoMark` brand assets

**Agent (server proxy + browser-side execution)**
- `netlify/functions/agent.ts` — the only door to MiniMax; holds `MINIMAX_APIKEY`; origin-locked; Anthropic-compatible route; tool catalog is server-owned (caller-supplied tools are ignored)
- `src/lib/agent-client.ts` — typed wrapper around `/api/agent`; error translation
- `src/lib/agent-tools-schema.ts` — shared tool catalog (browser + Function); **dependency-free on purpose** so the Function stays small (no viem, no Circle SDK)
- `src/lib/agent-tools.ts` — browser-side tool execution; read-only by design
- `src/hooks/useAppKitActions.ts` — headless swap + bridge via Circle App Kit; consumed by the agent's `swap_tokens` and `bridge_usdc` tools, returns discriminated unions
- `src/hooks/useAgent.ts` — tool-calling loop; hard-capped at `MAX_ROUNDS = 4`; tool results return to the model as data
- `src/lib/tracing.ts`, `src/lib/console-capture.ts` — telemetry / trace plumbing (paths may live under `src/`, not `src/lib/`)

**Scripts (outside `src/`)**
- `scripts/self-deploy.ts` — `bun run deploy:self`; deploys Foundry contracts (testnet path only — mainnet is documented in the script itself)
- `scripts/fetch-abi.ts` — `bun run fetch:abi <address>`; resolves a verified ABI from the explorer and writes `src/contracts/<Name>.json`
- `scripts/check.sh` — `bun run check`; runs the repo-level lint + typecheck gate

## Gotchas worth knowing before you change anything

- **The service worker lags one load behind.** A visitor's first page load after a deploy
  runs the previous bundle; the second one picks up the new build. Because the client key
  is inlined into the JS, a stale bundle means a stale credential. Hard-refresh when
  debugging. `vite.config.ts` mitigates this by serving navigations network-first.

- **Safari evicts script-writable storage on a 7-day cap** — IndexedDB *and* localStorage.
  The localStorage mirror in `src/lib/credential-store.ts` is *not* an exception; it
  exists only to survive IndexedDB being blocked by a privacy extension or a
  private-mode quirk, not to outlive Safari's 7-day cap on its own. In a PWA install
  Apple exempts *both* channels together, so the mirror is redundant for persistence
  but still useful as the fallback when IDB itself fails. Installing the PWA is the
  only thing that actually defeats the 7-day cap, which is why `usePwaInstall`
  (`src/lib/use-pwa-install.ts`) and `InstallBanner` exist. The
  `SessionPersistenceWarning` banner detects an imminent wipe by reading
  `lastVisit` from the same channel — when ITP evicts it, the read returns
  `null` and the warning fires the next time the user returns.

- **"The username is duplicated" means the wallet name is taken**, not that the credential
  is bad. Tell the user to use Sign in or pick another name.

- **Sign-out is gated twice on purpose: confirm modal + WebAuthn re-auth.** The
  confirm modal in `App.tsx` proves *intent* (the user typed the button, they
  read the warning), and `wallet.logout()` then calls `reauthWithPasskey()` to
  prove *identity* (the same authenticator that registered the wallet is still
  available). Either gate alone is weaker: re-auth alone is friction on every
  logout, confirm alone does not prove identity. Both are required before
  `forgetCredential` runs. Re-auth failure shows a Sonner toast and leaves the
  wallet state untouched.

- **`scrub()` is a defensive pass, not a debug aid.** It runs over every error string
  before it leaves `friendlyWalletError`. Without it, a Circle echo that includes the
  client key would render in the DOM. Any new code path that surfaces an SDK error to the
  user must go through `friendlyWalletError` (which calls `scrub`).

- **Write tools in the agent are gated by an in-chat proposal card + WebAuthn.**
  `useAgent` separates read tools (run immediately) from write tools (any name not in
  the read allowlist). For a write tool, the agent loop registers a `PendingProposal`
  in state and awaits a `Promise` that resolves only when the user clicks Confirm or
  Cancel on the proposal card. On Confirm, the tool runs for real and triggers
  WebAuthn from inside (`wallet.sendUsdc`). On Cancel, the tool returns
  `user_cancelled` to the model. The catalog in `agent-tools-schema.ts` exports
  `WRITE_TOOL_NAMES` for this split. The resolvers live in a `useRef<Map>` because
  functions cannot be stored in React state. The `reset()` handler must reject all
  pending proposals or the agent loop stays blocked forever.
  **Swap and bridge are wired in via `useAppKitActions`** — a headless hook that
  owns the AppKit + wagmi-connector wiring for `swapUsdc()` and `bridgeUsdc()`.
  The panels (`SwapPanel`, `BridgePanel`) still drive their own UI phase
  machines, but the agent calls the same `kit.swap` / `kit.bridge` paths
  through this hook. Each write tool is gated by an in-chat proposal card
  AND a WebAuthn prompt (the second fires from inside `kit.swap` / `kit.bridge`
  via the wagmi adapter, which is the user's passkey MSCA). Errors are
  classified (`cancelled` / `insufficient_funds` / `estimate_failed` /
  `swap_failed` / `bridge_failed`) and the model gets a one-line reason. The
  hook returns a discriminated union (`SwapResult` / `BridgeResult`) so the
  React boundary never sees a throw.

- **The Netlify Function is the only place a real secret is allowed.** `MINIMAX_APIKEY`
  has no `VITE_` prefix on purpose. The Function also origin-locks calls (`originAllowed`)
  as a cost control — it is *not* an authentication mechanism; real rate limiting belongs
  in front of it.

- **Several Circle SDK packages in `package.json` come from the Arc Studio template.**
  `developer-controlled-wallets`, `smart-contract-platform`, and `user-controlled-wallets`
  are not used at runtime in the app shell — only `app-kit`, `modular-wallets-core`, and
  `w3s-pw-web-sdk` are. The others exist for the deployment / contract workflows under
  `scripts/`. Do not delete them without grepping first.

- **`src/config.ts` lists `arcTestnet` alongside `arc` and `mainnet`.** The testnet entry
  is kept only so wagmi types resolve; the app does not expose it. `NetworkContext`
  returns `MAINNET_CONFIG` only.

- `src/main.tsx` already renders a "Built with Arc Studio" watermark, fixed bottom-right. Do
  not add a second credit; it will duplicate the existing one.

## To Run

```bash
bun install
bun run dev
```

Useful scripts:

```bash
bun run typecheck       # tsc --noEmit
bun run lint            # oxlint (type-aware)
bun run check           # bash scripts/check.sh (CI gate)
bun run deploy:self     # scripts/self-deploy.ts — Foundry deploy (testnet path only)
bun run fetch:abi       # scripts/fetch-abi.ts <address> — pull a verified ABI
bun run contracts:build # forge build
bun run contracts:test  # forge test
```

Local builds need `VITE_CLIENT_KEY_MAINNET` in `.env` (copy `.env.example` — it is
committed as a template). Production is built by Netlify from git, which supplies its own
env vars. A local build without `.env` is intentionally keyless (the Agent tab will be
unavailable, the wallet tab still works). **Never deploy `dist/` by hand** — there is no
other path for `MINIMAX_APIKEY` to reach the Function.
