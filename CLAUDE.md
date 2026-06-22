# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## What this repo is

`finalibaba-selfhosted` is the **public self-hosted edition** of [Finalibaba](https://github.com/LoicSERRE/Finalibaba), a personal wealth management dashboard. It contains the same core application stripped of personal deployment config, with community-oriented documentation.

**Goal:** anyone should be able to run the app with a single `docker compose up` and a `.env` filled in under 5 minutes.

## Language policy

- **All repo meta** (code comments, README, CLAUDE.md, commit messages, PR descriptions, issue templates) → **English**
- **UI strings** → managed by `next-intl`. English is the default language (`messages/en.json`). French is a translation (`messages/fr.json`).
- The private upstream repo (`Finalibaba/`) stays in French — it's personal.

## Relationship with the upstream private repo

The private repo is at `/mnt/c/Projets/Finalibaba/` on the same machine.

**Porting rule:** app-layer changes (features, bug fixes, schema changes) made in `Finalibaba/` should be ported here via `scripts/sync-from-upstream.sh`. Infra-layer changes (deploy pipeline, VPS config, personal credentials) are **never** ported.

Files excluded from selfhosted:

| Upstream file | Reason |
|---|---|
| `.github/workflows/deploy.yml` | Personal VPS deploy (loicserre.freeboxos.fr + private GHCR) |
| `docker-compose.server.yml` | Pre-built GHCR images + personal Cloudflare tunnel |
| `env.server.example` | Personal URLs |
| `CLAUDE.md` | Replaced by this file |
| `README.md` | Replaced by the public selfhosted README |
| `AGENTS.md` | Same |

Files that must **never** be overwritten by the sync script:

| File | Reason |
|---|---|
| `proxy.ts` | Selfhosted version has conditional auth — may diverge from upstream |
| `components/sidebar-wrapper.tsx` | Server component reading `AUTH_ENABLED` — selfhosted-specific |
| `components/sidebar-dynamic.tsx` | Selfhosted-only file, does not exist in upstream |
| `docker-compose.yml` / `docker-compose.dev.yml` | Different from upstream (build from source, generic credentials) |
| `.env.example` | Written from scratch for the selfhosted audience |

## Tech stack

Same as upstream.

- **Framework:** Next.js 16+ (App Router, Server Actions for mutations), React 19+
- **Styling & UI:** Tailwind CSS v4 with CSS custom properties (no config file — tokens in `globals.css`)
- **Database:** PostgreSQL via Prisma ORM — client generated to `app/generated/prisma`
- **Charts:** Recharts
- **Icons:** `lucide-react`
- **Sync service:** Python FastAPI + APScheduler (optional — runs without bank credentials)

> Always append `@latest` when installing packages.

## Development commands

```bash
npm run dev      # Dev server (http://localhost:3000)
NODE_ENV=production npm run build    # Prod build + type-check (NODE_ENV=production REQUIRED)
npm run lint     # ESLint
```

Docker (local dev — DB only):
```bash
docker compose -f docker-compose.dev.yml up -d
```

Production (one-shot setup):
```bash
cp .env.example .env   # fill in values
docker compose up -d   # builds and starts everything
```

Prisma:
```bash
npm run db:migrate -- --name <name>   # Create + apply migration
npx prisma generate                    # Regenerate client after schema changes
npm run db:seed                        # Seed common institutions
```

No test suite (no jest/vitest/playwright).

## Architecture

Same file layout as upstream — see `Finalibaba/CLAUDE.md` for the full architecture. Selfhosted-specific points below.

### Authentication

**Disabled by default** (`AUTH_ENABLED` unset or anything other than `"true"`). Self-hosted = private network, network-level trust is sufficient.

Enabled via `AUTH_ENABLED=true` + `AUTH_PASSWORD` (plaintext) or `AUTH_PASSWORD_HASH` (bcrypt). When enabled: NextAuth Credentials provider, JWT session 30d, rate-limit 5 attempts/15min/IP. Display name via `AUTH_USER_NAME` (defaults to `"owner"`).

`proxy.ts` reads `process.env.AUTH_ENABLED` in the `authorized` callback and bypasses NextAuth when it isn't `"true"`. If the upstream `proxy.ts` ever diverges, do **not** blindly overwrite this file.

`sidebar-wrapper.tsx` is a **server component** (no `"use client"`) — reads `AUTH_ENABLED`, passes `showLogout` prop to `sidebar-dynamic.tsx`.
`sidebar-dynamic.tsx` is a **client component** (`"use client"`) — handles `dynamic({ ssr: false })` (required to be in a client component in Next.js 16). This file does not exist in the upstream repo.
Both files are selfhosted-specific and must never be overwritten by the sync script.

For users who want security without built-in auth: document Nginx Proxy Manager, Caddy basicauth, Traefik + Authelia, Cloudflare Access, or VPN (Tailscale).

### i18n

**Not implemented in v1 — UI is in French.** i18n is a planned post-v1 milestone, bundled with configurable tax rates. See ROADMAP.md.

When implemented: `next-intl`, `messages/en.json` (default), `messages/fr.json`. No URL prefix per locale.

### Sync service — optional modules

The `sync/` service has three independent modules:

| Module | Required credentials | Bank |
|---|---|---|
| `sync_lcl.py` | `LCL_LOGIN`, `LCL_PASSWORD` | LCL (FR) via Woob |
| `sync_tr.py` | `TR_PHONE`, `TR_PIN` | Trade Republic via pytr |
| `sync_swile.py` | `SWILE_LOGIN`, `SWILE_PASSWORD` | Swile (meal vouchers, FR) |

Leave credentials blank to disable a module. `sync/main.py` skips gracefully. `sync/db.py` contains shared PostgreSQL helpers — do not duplicate inline.

### Tax rates

Currently hardcoded as `TAX_RATES` constants in 4 files (`app/page.tsx:14`, `app/accounts/page.tsx:45`, `app/accounts/[id]/page.tsx:41`, `app/analytics/page.tsx:35`). Default values are French rates (PEA 17.2%, CTO 31.4%, Crypto 30%). Post-v1, these will move to `UserSettings` to be user-configurable.

### Data model

- `Institution` → many `Account`
- `Account` (`AccountType`: `CHECKING | SAVINGS | INVESTMENT | REAL_ESTATE | MEAL_VOUCHER | CRYPTO | AUTOMOBILE | LOAN`)
  - Fiat (CHECKING, SAVINGS, MEAL_VOUCHER): `HistoricalBalance` (balance in cents as `BigInt`)
  - Investment/Crypto: `Holding` (ticker + `Decimal` quantity) + live price at runtime. `investmentSubtype` = `"PEA"` or `"CTO"`
  - Real Estate & Automobile: `manualValueCents` + optional `liabilityCents`
  - LOAN: capital computed at runtime via `calcCurrentCapital()` from `lib/loan.ts`
- `Holding` — unique on `(accountId, ticker)`. `costBasisCents` for P&L
- `HistoricalBalance` — daily balance snapshots
- `Transaction` — bank movements. `amountCents`: positive = credit, negative = debit. Deduplicated via `syncId`
- `UserSettings` — singleton (`id = "singleton"`): salary, expenses, savings goal, monthly saved

### Net worth calculation

**Gross = fiat balances + holdings market value + real estate/automobile manualValueCents**
**Net = Gross − liabilityCents − loan remaining capital − latent taxes**

Latent tax rates: PEA 17.2%, CTO 31.4%, Crypto 30% (French defaults, will be configurable post-v1).

### Server vs Client boundary

- All Prisma queries and third-party API calls **must** live in Server Components or Server Actions.
- Chart and interactive UI components are `"use client"`. Pass pre-fetched data as props.

### Amounts & precision

All monetary values stored as **integer cents** (`BigInt`). Arithmetic via `Decimal.js`. Format with `Intl.NumberFormat` (locale-aware via `next-intl`).

## Design tokens

Defined in `globals.css`. Never use raw Tailwind colour classes for brand colours.

| Token | Value | Use |
|---|---|---|
| `--accent` | #6366f1 | Active nav, primary highlight |
| `--positive` | #22c55e | Positive deltas |
| `--negative` | #ef4444 | Negative deltas, liabilities |
| `--surface` | #13131a | Card backgrounds |
| `--surface-elevated` | #1a1a24 | Hover states |
| `--border` | #2a2a38 | Dividers |
| `--muted` | #6b7280 | Secondary text |

## Next.js version note

This project uses Next.js 16+, which has breaking changes from training data. Before writing Next.js-specific code, check `node_modules/next/dist/docs/` for current APIs and conventions. Heed deprecation notices.
