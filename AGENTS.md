# [App Name]

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

A self-custodial USDC wallet on **Arc Mainnet**, built end to end in Arc Studio. Users
create a smart account with a passkey (Circle Modular Wallets / WebAuthn, ERC-4337 MSCA);
there is no seed phrase and no private key ever reaches the client. Send, Receive, Swap
and Bridge live in the tab.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Wallet: **Circle Modular Wallets** — passkey (WebAuthn) signer on a Modular Smart Contract Account. Not an injected EOA; there is no seed phrase.
- Chain: **Arc Mainnet only** (Chain ID: 5042, from `viem/chains`, path `/arc`). Testnet is hard-removed, not configurable.
- Token: USDC (6 decimals), `0x3600000000000000000000000000000000000000` on Arc Mainnet
- Storage: IndexedDB (`src/lib/credential-store.ts`) for the remembered wallet, plus a PWA install prompt
- Toasts: Sonner

## Configuration

`VITE_CLIENT_KEY_MAINNET` is the **only** environment variable. Everything else (chain id,
chain path, USDC address, RPC URL, explorer) is a constant in `src/lib/circle-config.ts`.
A Circle *client* key is designed to ship in a browser bundle — it is not a secret, so it
is committed nowhere and printed nowhere. Keep it that way: report only length, prefix and
SHA-256 fingerprint when comparing keys.

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)
- `src/lib/circle-config.ts` - Arc Mainnet constants + the client key read
- `src/lib/credential-store.ts` - IndexedDB credential persistence (tab vs device)
- `src/lib/wallet-errors.ts` - maps SDK errors to actionable copy; `scrub()` redacts the key
- `src/hooks/useCircleWallet.ts` - passkey register/login, MSCA address, USDC send

## Gotchas worth knowing before you change anything

- **The service worker lags one load behind.** A visitor's first page load after a deploy
  runs the previous bundle; the second one picks up the new build. Because the client key is
  inlined into the JS, a stale bundle means a stale credential. Hard-refresh when debugging.
- **Safari evicts script-writable storage on a 7-day cap** — IndexedDB included. Moving off
  localStorage does *not* defeat it; installing the PWA does, because Apple exempts Home
  Screen web apps. That is why `usePwaInstall` exists.
- **"The username is duplicated" means the wallet name is taken**, not that the credential is
  bad. Tell the user to use Sign in or pick another name.
- `src/main.tsx` already renders a "Built with Arc Studio" watermark, fixed bottom-right. Do
  not add a second credit; it will duplicate the existing one.

## To Run

```bash
bun install
bun run dev
```

Local builds need `VITE_CLIENT_KEY_MAINNET` in `.env` (copy `.env.example`). Production is
built by Netlify from git, which supplies its own env var — a local build without `.env` is
intentionally keyless, so never deploy `dist/` by hand.
