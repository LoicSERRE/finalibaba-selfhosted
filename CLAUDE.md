# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## What this repo is

`finalibaba-selfhosted` is the **public self-hosted edition** of [Finalibaba](https://github.com/LoicSERRE/Finalibaba), a personal wealth management dashboard. It contains the same core application stripped of personal deployment config, with community-oriented documentation.

**Goal:** anyone should be able to run the app with a single `docker compose up` and a `.env` filled in under 5 minutes.

## Language policy

- **All repo meta** (code comments, README, CLAUDE.md, commit messages, PR descriptions, issue templates) → **English**
- **UI strings** → French by default. English is available via the language switcher (stored in `NEXT_LOCALE` cookie). Add new UI strings to both `messages/fr.json` and `messages/en.json`.
- The private upstream repo (`Finalibaba/`) stays in French — it's personal.

## Relationship with the upstream private repo

The private repo is at `/mnt/c/Projets/Finalibaba` on the same machine (default path baked into `scripts/sync-from-upstream.sh`; override with `./scripts/sync-from-upstream.sh <path>`).

**Porting rule:** app-layer changes (features, bug fixes, schema changes) made in `Finalibaba/` should be ported here via `scripts/sync-from-upstream.sh`. Infra-layer changes (deploy pipeline, VPS config, personal credentials) are **never** ported.

The script's `rsync --exclude` list is the source of truth for what never gets synced — it covers infra files (`.github/`, all `docker-compose*.yml`, `env.server.example`, `.env*`), selfhosted-only docs (`CLAUDE.md`, `README.md`, `AGENTS.md`, `ROADMAP.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `LICENSE`), demo/mock seed files (`prisma/seed-demo.ts`, `prisma/seed-tr-mock.ts`), and `scripts/`, `.claude/` themselves. The files below additionally need protection because they *do* exist upstream but must keep selfhosted-specific content:

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

Docker (local dev — DB only, credentials fixed in `docker-compose.dev.yml`):
```bash
docker compose -f docker-compose.dev.yml up -d
# DATABASE_URL=postgresql://appuser:devpassword@localhost:5432/finalibaba
npx prisma migrate deploy   # first time only — applies schema to the fresh DB
npm run db:seed:demo        # optional — fills it with realistic fictional data to develop against
```

Production (one-shot setup):
```bash
cp .env.example .env   # fill in values
docker compose up -d   # builds and starts everything
```

Prisma:
```bash
npm run db:migrate -- --name <name>   # Create + apply migration
npx prisma generate                    # Regenerate client after schema changes (also runs automatically via postinstall on `npm install`)
npm run db:seed                        # Seed common institutions (reference data, no accounts)
npm run db:seed:demo                   # WIPES all data, then seeds realistic fictional accounts/balances/holdings/transactions — for local dev/debugging
npm run db:push                        # Sync schema to DB without a migration (dev only)
npm run db:studio                      # Open Prisma Studio for DB inspection
```

npm scripts for Docker — prefer the direct commands above, these are misleadingly named:
```bash
npm run docker:dev        # docker compose up -d       (despite the name, this runs the default/production docker-compose.yml)
npm run docker:dev:stop   # docker compose down
npm run docker:prod       # BROKEN — references docker-compose.prod.yml, which does not exist in this repo
```

No test suite (no jest/vitest/playwright).

### npm overrides

`package.json` contains an `overrides` block that forces patched versions of transitive dependencies that can't be resolved by Dependabot alone (upstream packages pin older ranges). Do not remove these entries — they are security fixes:

CI's `npm audit` step runs as `npm audit --omit=dev --audit-level=high` — deliberately excluding devDependencies (ESLint, TypeScript, etc.). Those never ship: the Docker `runner` stage installs with `npm ci --omit=dev`, so a devDependency-only advisory (e.g. through `eslint`'s vendored `minimatch`) can't reach production and isn't worth chasing at the cost of breaking the lint toolchain. `prisma` is a runtime `dependencies` entry (not dev) precisely because the `Dockerfile`'s `CMD` runs `npx prisma migrate deploy` inside the `runner` stage at container start — so `prisma`/`@prisma/dev`-rooted advisories (hono, `@hono/node-server`, valibot) are real and stay in scope.

| Package | Reason |
|---|---|
| `uuid >=11.1.1` | CVE-2026-41907 — buffer bounds check; pinned to `^8.3.2` by `next-auth` |
| `postcss >=8.5.23` | GHSA-r28c-9q8g-f849 — path traversal via `sourceMappingURL`; vendored by `next` |
| `@hono/node-server >=1.19.13` | CVE-2026-39406 — middleware bypass; pulled in via `@prisma/dev` |
| `sharp >=0.35.0` | GHSA-f88m-g3jw-g9cj — libvips CVEs; vendored by `next`'s image optimizer |
| `js-yaml >=4.3.0` | GHSA-52cp-r559-cp3m — quadratic-CPU DoS via merge-key chains; pulled in by `eslint`'s `@eslint/eslintrc` |
| `eslint-plugin-react-hooks` pinned to `7.0.1` | Not a CVE fix — its `^7.0.0` range floats onto `7.1.1`, which enables new `react-hooks/purity`/`react-hooks/immutability` rules that fail on pre-existing code unrelated to any dependency bump. Pinned to avoid that scope creep; revisit separately if those rules are worth fixing for real. |
| Nested `@typescript-eslint/typescript-estree` → `minimatch` → `brace-expansion >=5.0.8` and `eslint` → `minimatch` → `brace-expansion >=1.1.16` | GHSA-mh99-v99m-4gvg. A flat top-level `brace-expansion` override breaks `eslint`'s own vendored `minimatch@3.1.5`, which expects the old `brace-expansion` 1.x API (`expand is not a function` otherwise) — hence two scoped overrides instead of one, each keeping the major version its parent expects. |

## Architecture

### File layout

```
app/                  Next.js App Router pages and Server Actions
  generated/prisma/   Prisma client (generated — do not edit)
  globals.css         Design tokens + Tailwind base
  global-error.tsx    Global error boundary (client component, force-dynamic)
components/
  ui/                 Radix UI primitive wrappers — currently button.tsx, dialog.tsx, input.tsx
  (other)             Feature components — dialogs, charts, sync buttons, etc.
lib/
  actions/            Server Actions (all DB mutations go here)
  auth.ts             NextAuth config + in-memory rate limiter
  format.ts           Monetary helpers: cents↔Decimal, formatCurrency, formatPercent
  gocardless.ts       GoCardless API client (token cache, typed fetch helpers)
  institutions.ts     Bank/broker name → favicon domain mapping (used for logos)
  loan.ts             calcCurrentCapital() helper
  prisma.ts           Singleton PrismaClient via @prisma/adapter-pg + pg Pool
messages/
  fr.json             French UI strings (default locale)
  en.json             English UI strings
i18n/
  request.ts          next-intl locale detection (cookie → Accept-Language → DEFAULT_LOCALE)
prisma/
  schema.prisma       Data model
  migrations/         Applied migrations
  seed.ts             Institution seed data
prisma.config.ts      Prisma config (schema path, migrations path, DB URL from env)
sync/                 Python FastAPI service (optional bank sync)
  main.py             APScheduler entry point + credential guards
  db.py               Shared PostgreSQL helpers
  sync_lcl.py         LCL (FR) via Woob (hardcoded module)
  sync_tr.py          Trade Republic via pytr
  sync_woob.py        Generic Woob runner for user-configured institutions
  setup_lcl.py        Interactive first-time LCL setup
  setup_tr.py         Interactive first-time Trade Republic setup
public/               Static assets (includes manifest.json for PWA)
proxy.ts              Next.js middleware (root) — auth bypass + demo POST-blocking
```

Selfhosted-specific points below.

### Authentication

**Disabled by default** (`AUTH_ENABLED` unset or anything other than `"true"`). Self-hosted = private network, network-level trust is sufficient.

Enabled via `AUTH_ENABLED=true` + `AUTH_PASSWORD` (plaintext) or `AUTH_PASSWORD_HASH` (bcrypt). When enabled: NextAuth Credentials provider, JWT session 30d, rate-limit 5 attempts/15min/IP. Display name via `AUTH_USER_NAME` (defaults to `"owner"`).

`proxy.ts` is the Next.js middleware (at the repo root). It reads `process.env.AUTH_ENABLED` in the `authorized` callback and bypasses NextAuth when it isn't `"true"`. If the upstream `proxy.ts` ever diverges, do **not** blindly overwrite this file.

`sidebar-wrapper.tsx` is a **server component** (no `"use client"`) — reads `AUTH_ENABLED`, passes `showLogout` prop to `sidebar-dynamic.tsx`.
`sidebar-dynamic.tsx` is a **client component** (`"use client"`) — handles `dynamic({ ssr: false })` (required to be in a client component in Next.js 16). This file does not exist in the upstream repo.
Both files are selfhosted-specific and must never be overwritten by the sync script.

For users who want security without built-in auth: document Nginx Proxy Manager, Caddy basicauth, Traefik + Authelia, Cloudflare Access, or VPN (Tailscale).

### i18n

Implemented via `next-intl`. Locale detection order: `NEXT_LOCALE` cookie → `Accept-Language` header → `DEFAULT_LOCALE` env var (defaults to `"fr"`). Supported locales: `fr` (default) and `en`. No URL prefix per locale.

UI strings live in `messages/fr.json` and `messages/en.json`. When adding new strings, update both files. Institution logos are fetched from Google Favicons using domain mappings in `lib/institutions.ts`.

### Demo mode

Set `DEMO_MODE=true` to enable a read-only public demo. `proxy.ts` intercepts all non-GET requests and returns 403. The `<AutoSync />` component on the dashboard is also disabled. Use `docker-compose.demo.yml` for a pre-seeded demo environment.

### GoCardless (Open Banking PSD2)

Optional. EU + UK bank connections via the official PSD2 API (free tier: 50 connections, 90-day history).

Credentials: `GOCARDLESS_SECRET_ID` + `GOCARDLESS_SECRET_KEY`. Set `APP_URL` to the app's public URL when behind a reverse proxy — it's used as the OAuth callback after bank authentication. Leave `APP_URL` blank for localhost use.

GoCardless logic lives in the Next.js app (not the `sync/` service).

### App ↔ Sync service communication

The Next.js app calls the Python sync service via HTTP using `SYNC_SERVICE_URL=http://sync:8000` (set automatically in `docker-compose.yml`). In development, the sync service is not started — only the DB runs via `docker-compose.dev.yml`.

### Sync service — optional modules

The `sync/` service has two dedicated sync modules plus a generic Woob runner:

| Module | Required credentials | Purpose |
|---|---|---|
| `sync_lcl.py` | `LCL_LOGIN`, `LCL_PASSWORD` | LCL (FR) via Woob hardcoded module |
| `sync_tr.py` | `TR_PHONE`, `TR_PIN` | Trade Republic via pytr |
| `sync_woob.py` | Set per-institution in UI | Generic Woob runner for any institution configured in Settings |

Leave credentials blank to disable a module. `sync/main.py` skips gracefully. `sync/db.py` contains shared PostgreSQL helpers — do not duplicate inline.

### Backup & restore

Two paths, both wrap `pg_dump`/`psql` (full DB dump — schema + data, never a hand-rolled Prisma export, to avoid drift and BigInt/Decimal serialization issues):

- **CLI**: `scripts/backup.sh` / `scripts/restore.sh` — call `docker compose exec db pg_dump|psql`. `restore.sh` pauses `app`/`sync` if present and requires typed confirmation.
- **UI**: Settings → Backup & restore (`components/backup-restore-section.tsx`), backed by `app/api/backup/route.ts` (`GET` streams a gzip dump, `POST` restores from an uploaded file, auto-detecting gzip vs plain `.sql`). This runs `pg_dump`/`psql` from inside the `app` container itself — that's why the `runner` stage in `Dockerfile` installs `postgresql16-client` (must track the `postgres:16-alpine` server version; a client older than the server can't dump it). Hidden entirely in `DEMO_MODE` (matches the auto-sync section's pattern).

Both directions use `pg_dump --clean --if-exists` (so restore drops/recreates objects first) and `psql --single-transaction` (restore is all-or-nothing, no partial state on error). Never echo raw `pg_dump`/`psql` stderr to the client — log it server-side and return a generic error message, per the exception-exposure fix in commit `1ae43c0`.

Implementation notes (post-v1.2.0 audit fixes):

- `buildConnectionString()` passes the *whole* `DATABASE_URL` (password stripped, everything else — including query params like `?sslmode=require` — intact) as a single positional arg to `pg_dump`/`psql`, with the password supplied separately via `PGPASSWORD`. Don't go back to manually extracting `host`/`port`/`user`/`database` into separate `-h`/`-p`/`-U`/`-d` flags — that approach silently drops any connection query params.
- The `GET` handler's `ReadableStream` only closes successfully once **both** `gzip`'s `"end"` (all bytes flushed) and `pg_dump`'s `"close"` (exit code known) have fired, and only if the exit code was `0`. A pg_dump that dies mid-dump after already writing valid-looking output must **error**, not silently succeed — a truncated "successful" backup is far worse than a visibly failed download, since the corruption would otherwise only surface during an actual restore. The `settled` flag guards every controller call this can race with (`enqueue`, `close`, `error`) — including `cancel()`, which must also set it (a client aborting mid-download must not let a still-queued `gzip.on("data")` callback call `enqueue()` on an already-cancelled stream and crash the process).
- After a successful restore, the process calls `process.exit(0)` (gated to `NODE_ENV === "production"`, so local `npm run dev` isn't killed) so the container's `restart: unless-stopped` policy hands the app a fresh Prisma connection pool — the restore just dropped and recreated the whole schema out from under any pooled connections' cached query plans, the same reason `scripts/restore.sh` stops the `app` container before restoring. `components/backup-restore-section.tsx` polls the current page with a `HEAD` request (never `/api/backup` — that would trigger another full `pg_dump`) until the app responds again before reloading.

### CSV import (transactions & balance history)

For fiat accounts (`CHECKING`/`SAVINGS`/`MEAL_VOUCHER`) not covered by auto-sync — gated by `canImportCsv = isFiat && !isSynced && !account.gocardlessAccountId` in `app/accounts/[id]/page.tsx`. Two independent entry points, both rendered wherever that condition holds:

- **Transactions** — `components/import-transactions-dialog.tsx` + `lib/actions/transactions.ts`'s `importTransactions(accountId, rows)`. Writes `Transaction` rows.
- **Balance history** — `components/import-balance-history-dialog.tsx` + `lib/actions/balances.ts`'s `importBalanceHistory(accountId, rows)`. Writes `HistoricalBalance` rows at noon UTC (`${date}T12:00:00.000Z`, same convention as `prisma/seed-demo.ts` — avoids a midnight-UTC day shift in negative-offset timezones). Because the dashboard's net-worth-over-time chart (`app/page.tsx`) is built by aggregating `HistoricalBalance` across every account grouped by day, backfilling this way also backfills that chart — no separate "net worth snapshot" model exists or is needed.
  - Deliberately **not** offered for `LOAN` (its balance is computed at runtime via `calcCurrentCapital()`, never stored — importing a raw balance would double as a false asset in the dashboard aggregation, which doesn't know to treat it as a liability) or for `INVESTMENT`/`CRYPTO`/`REAL_ESTATE`/`AUTOMOBILE` (their current-value source of truth is holdings+live price or `manualValueCents`, not the latest `HistoricalBalance` row — importing snapshots there would create a chart whose last point silently disagrees with the value shown in the account header). Fiat accounts are the one type where `HistoricalBalance` is already the authoritative source for both current value and chart history, so there's no such discontinuity risk.

Shared design across both importers:

- CSV parsing, date parsing, header aliasing, and validation live in `lib/csv-import.ts` (`parseCsvDate`, `isFutureDate`, `looksNumeric`, `makeHeaderNormalizer`) — shared by both dialog components so a fix in one place reaches both importers. Parsing and duplicate detection happen **entirely client-side** — no server round-trip until the user confirms. Header aliases (French: `libellé`/`montant`/`solde`/`valeur`) and both `YYYY-MM-DD`/`DD/MM/YYYY` date formats are accepted.
- `looksNumeric()` rejects non-numeric-but-non-empty values (`"N/A"`, `"#REF!"`, `"3.5abc"`) before they reach `parseCents()` — `parseCents()` itself falls back to `0` on `NaN` (a deliberate leniency other callers, like the settings tax-rate inputs, rely on), so without this guard a garbage CSV cell would silently import as a real €0.00 row instead of being flagged.
- `isFutureDate()` rejects balance-history rows dated after today (UTC) — without it, a typo'd date (e.g. `2062` instead of `2026`) would become the account's displayed "current balance" everywhere (`app/page.tsx`, `app/accounts/[id]/page.tsx` both take `history[0]` ordered by `recordedAt desc`), with no delete UI to undo it. Transactions don't get this check — nothing reads "the most recent transaction" as a current-value source, so a future-dated transaction isn't a correctness bug the way a future-dated balance is.
- Both `importTransactions` and `importBalanceHistory` call `lib/actions/csv-import-guard.ts`'s `assertCsvImportEligible(accountId)` before writing anything — it re-derives the same eligibility rule as the page's `canImportCsv` (fiat type, not synced, no `gocardlessAccountId`). **Do not remove this** even though the UI already hides the import buttons for ineligible accounts: Server Actions are directly invocable regardless of what's rendered, and this is the only thing stopping a stale page or a future call site from writing CSV data onto a `LOAN`/`INVESTMENT`/synced account.
- "Duplicate" is advisory, not a hard constraint — flagged rows are unchecked by default but the user can still import them. Transactions: flagged when `date|label|amountCents` matches an existing `Transaction` for that account. Balance history: flagged when a `HistoricalBalance` already exists for that exact date. There is no hash-based auto-merge for transactions specifically, because two legitimately different transactions can share a fingerprint (e.g. two identical recurring debits on the same day) — auto-merging on content hash would silently drop one.
- Existing-row fingerprints/dates are computed server-side in the page and passed down as plain `string[]` props — never pass `BigInt` values to a Client Component, following the same "no BigInt across the RSC boundary" rule as `components/export-accounts-button.tsx`.
- Every imported `Transaction`/`HistoricalBalance` row is stored at **noon UTC** (`${date}T12:00:00.000Z`), not midnight — both importers must agree on this (they didn't originally: `importTransactions` used midnight, causing a one-day shift on negative-UTC-offset deployments that `importBalanceHistory` didn't have). Midnight UTC is one keystroke away from reintroducing that bug — don't "simplify" it back to `new Date(r.date)`.
- Every imported `Transaction` gets a fresh `syncId` (`csv_` + `randomUUID()`); neither importer attempts idempotent re-import matching like the Woob/GoCardless sync paths do with their own bank-provided IDs. Re-importing the same file twice creates duplicates — that's what the client-side duplicate flagging is for.

### Tax rates

Stored in `UserSettings` (`taxRatePea`, `taxRateCto`, `taxRateCrypto`). All four pages that compute latent taxes (`app/page.tsx`, `app/accounts/page.tsx`, `app/accounts/[id]/page.tsx`, `app/analytics/page.tsx`) fetch settings and use the user-defined rates. Defaults: PEA 17.2%, CTO 31.4%, Crypto 31.4%.

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
- `SyncLog` — per-run log entries: `source` ("lcl" | "trade_republic"), `status` ("success" | "error" | "auth_required"), optional `message`
- `UserSettings` — singleton (`id = "singleton"`): salary, expenses, savings goal, monthly saved, `taxRatePea`/`taxRateCto`/`taxRateCrypto` (Float, defaults 0.172/0.314/0.314)

### Net worth calculation

**Gross = fiat balances + holdings market value + real estate/automobile manualValueCents**
**Net = Gross − liabilityCents − loan remaining capital − latent taxes**

Latent tax rates: read from `UserSettings` (defaults: PEA 17.2%, CTO 31.4%, Crypto 31.4%). User-editable in Settings → Fiscalité.

### Prisma client

This project uses **Prisma 7** with the `@prisma/adapter-pg` driver adapter (not the legacy built-in engine). `lib/prisma.ts` creates the client via a `pg.Pool` → `PrismaPg` adapter. Always import `prisma` from `@/lib/prisma` — never instantiate `PrismaClient` directly. The client is a module-level singleton (cached on `globalThis` in dev to survive HMR).

The client is generated to `app/generated/prisma` (gitignored, never committed). `npm install` runs it automatically via the `postinstall` script; re-run `npx prisma generate` manually after editing `schema.prisma` without reinstalling. In `Dockerfile`, the `deps` and `runner` stages run `npm ci` with `--ignore-scripts` because `prisma/schema.prisma` isn't copied into those stages yet — the `builder` stage generates the client explicitly once the full source is present.

### Server vs Client boundary

- All Prisma queries and third-party API calls **must** live in Server Components or Server Actions.
- Chart and interactive UI components are `"use client"`. Pass pre-fetched data as props.

### Amounts & precision

All monetary values stored as **integer cents** (`BigInt`). Arithmetic via `Decimal.js`. Use helpers from `lib/format.ts` for conversion and display (do not inline formatting logic). Institution logos are fetched at runtime via Google Favicons using domain mappings in `lib/institutions.ts` — add new institutions there, not inline.

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
| `--muted` | #a1a1aa | Secondary text |

## Next.js version note

This project uses Next.js 16+, which has breaking changes from training data. Before writing Next.js-specific code, check `node_modules/next/dist/docs/` for current APIs and conventions. Heed deprecation notices.
