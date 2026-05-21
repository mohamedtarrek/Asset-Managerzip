# BundleX (Svarog)

A full-stack Solana meme token launch platform for Pump.Fun power users. Bundle-launch tokens with multiple wallets, run bump bots, and manage up to 200 Solana keypairs — all from a single dark-themed trading terminal.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied at /api)
- `pnpm --filter @workspace/svarog run dev` — run the frontend (port 20984, proxied at /)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `SESSION_SECRET` — used for AES-256 wallet key encryption

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, wouter, TanStack Query, shadcn/ui, lucide-react
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (zod/v4), drizzle-zod
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth for all endpoints)
- `lib/api-zod/src/generated/api.ts` — Generated Zod schemas (do not edit)
- `lib/api-client-react/src/generated/api.ts` — Generated React Query hooks (do not edit)
- `lib/db/src/schema/` — Drizzle ORM table definitions
- `artifacts/api-server/src/routes/` — Express route handlers (wallets, bundles, bots, dashboard, tokens)
- `artifacts/svarog/src/pages/` — React page components
- `artifacts/svarog/src/components/layout.tsx` — Sidebar + topbar layout
- `artifacts/svarog/src/lib/wallet-context.tsx` — Wallet address state/context (localStorage)

## Architecture decisions

- Wallet identity is a Solana address entered manually (no Phantom wallet adapter). Stored in localStorage. Passed as `ownerAddress`/`walletAddress` query param to all API calls.
- Private keys are AES-256-CBC encrypted with SESSION_SECRET before storage. Never returned by any API endpoint.
- Keypairs are mock-generated (Base58-safe random strings) — swap `generateMockKeypair()` with `@solana/web3.js` `Keypair.generate()` for production.
- Token metadata for VAMP is a stub — replace with Pump.Fun API call in production.
- Wallet balances are stored locally in the DB; refresh via `/wallets/:id/balance` which applies a mock SOL/USD conversion.

## Product

- **Dashboard** — earnings, balance, PNL, bundle count, activity feed, market price tickers
- **Token Launch** — New Bundle (fresh token), VAMP (copy existing CA), CTO (coming soon)
- **Bundles** — full history with stats, search, performance tracking, Pump.Fun links
- **Wallets** — generate, import, bulk-generate, group filter, selection, 0/200 storage bar
- **Bump Bot** — create bots with live cost estimation, start/pause/stop controls
- **Settings** — tabbed: account defaults, RPC endpoint, notifications, quick actions

## User preferences

- Dark neon theme, always dark mode (no toggle to light mode)
- No emojis in the UI
- Generic brand name "BundleX" (not "Svarog") in the sidebar wordmark

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after editing `openapi.yaml`, then `pnpm run typecheck:libs` to rebuild declaration files
- The `@workspace/db` lib must be rebuilt (`pnpm run typecheck:libs`) before the API server can typecheck against new schema exports
- Do NOT add `artifacts/*` to root `tsconfig.json` references
- Bot estimate runs as a mutation (POST), not a query

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
