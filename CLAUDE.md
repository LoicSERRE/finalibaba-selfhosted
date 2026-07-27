# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## What this repo is

`finalibaba-selfhosted` is the **public self-hosted edition** of [Finalibaba](https://github.com/LoicSERRE/Finalibaba), a personal wealth management dashboard. It contains the same core application stripped of personal deployment config, with community-oriented documentation.

**Goal:** anyone should be able to run the app with a single `docker compose up` and a `.env` filled in under 5 minutes.

## Language policy

- **All repo meta** (code comments, README, CLAUDE.md, commit messages, PR descriptions, issue templates) → **English**
- **UI strings** → French by default. English is available via the language switcher (stored in `NEXT_LOCALE` cookie). Add new UI strings to both `messages/fr.json` and `messages/en.json`.
- The private upstream repo (`Finalibaba/`) stays in French - it's personal.

## Relationship with the upstream private repo

The private repo is at `/mnt/c/Projets/Finalibaba` on the same machine (default path baked into `scripts/sync-from-upstream.sh`; override with `./scripts/sync-from-upstream.sh <path>`).

**Porting rule:** app-layer changes (features, bug fixes, schema changes) made in `Finalibaba/` should be ported here via `scripts/sync-from-upstream.sh`. Infra-layer changes (deploy pipeline, VPS config, personal credentials) are **never** ported.

The script's `rsync --exclude` list is the source of truth for what never gets synced - it covers infra files (`.github/`, all `docker-compose*.yml`, `env.server.example`, `.env*`), selfhosted-only docs (`CLAUDE.md`, `README.md`, `AGENTS.md`, `ROADMAP.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `LICENSE`), demo/mock seed files (`prisma/seed-demo.ts`, `prisma/seed-tr-mock.ts`), and `scripts/`, `.claude/` themselves. The files below additionally need protection because they *do* exist upstream but must keep selfhosted-specific content:

Files that must **never** be overwritten by the sync script:

| File | Reason |
|---|---|
| `proxy.ts` | Selfhosted version has conditional auth - may diverge from upstream |
| `components/sidebar-wrapper.tsx` | Server component reading `AUTH_ENABLED` - selfhosted-specific |
| `components/sidebar-dynamic.tsx` | Selfhosted-only file, does not exist in upstream |
| `docker-compose.yml` / `docker-compose.dev.yml` | Different from upstream (build from source, generic credentials) |
| `.env.example` | Written from scratch for the selfhosted audience |

## Tech stack

Same as upstream.

- **Framework:** Next.js 16+ (App Router, Server Actions for mutations), React 19+
- **Styling & UI:** Tailwind CSS v4 with CSS custom properties (no config file - tokens in `globals.css`)
- **Database:** PostgreSQL via Prisma ORM - client generated to `app/generated/prisma`
- **Charts:** Recharts
- **Icons:** `lucide-react`
- **Sync service:** Python FastAPI + APScheduler (optional - runs without bank credentials)

> Always append `@latest` when installing packages.

## Development commands

```bash
npm run dev      # Dev server (http://localhost:3000)
NODE_ENV=production npm run build    # Prod build + type-check (NODE_ENV=production REQUIRED)
npm run lint     # ESLint
```

Docker (local dev - DB only, credentials fixed in `docker-compose.dev.yml`):
```bash
docker compose -f docker-compose.dev.yml up -d
# DATABASE_URL=postgresql://appuser:devpassword@localhost:5432/finalibaba
npx prisma migrate deploy   # first time only - applies schema to the fresh DB
npm run db:seed:demo        # optional - fills it with realistic fictional data to develop against
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
npm run db:seed:demo                   # WIPES all data, then seeds realistic fictional accounts/balances/holdings/transactions - for local dev/debugging
npm run db:push                        # Sync schema to DB without a migration (dev only)
npm run db:studio                      # Open Prisma Studio for DB inspection
```

npm scripts for Docker - prefer the direct commands above, these are misleadingly named:
```bash
npm run docker:dev        # docker compose up -d       (despite the name, this runs the default/production docker-compose.yml)
npm run docker:dev:stop   # docker compose down
npm run docker:prod       # BROKEN - references docker-compose.prod.yml, which does not exist in this repo
```

No test suite (no jest/vitest/playwright).

### npm overrides

`package.json` contains an `overrides` block that forces patched versions of transitive dependencies that can't be resolved by Dependabot alone (upstream packages pin older ranges). Do not remove these entries - they are security fixes:

CI's `npm audit` step runs as `npm audit --omit=dev --audit-level=high` - deliberately excluding devDependencies (ESLint, TypeScript, etc.). Those never ship: the Docker `runner` stage installs with `npm ci --omit=dev`, so a devDependency-only advisory (e.g. through `eslint`'s vendored `minimatch`) can't reach production and isn't worth chasing at the cost of breaking the lint toolchain. `prisma` is a runtime `dependencies` entry (not dev) precisely because the `Dockerfile`'s `CMD` runs `npx prisma migrate deploy` inside the `runner` stage at container start - so `prisma`/`@prisma/dev`-rooted advisories (`find-my-way`, `valibot`, formerly `hono`/`@hono/node-server` before prisma 7.9 dropped that dependency) get installed by `npm ci --omit=dev` and stay in scope even though the specific vulnerable code path (`@prisma/dev`'s embedded-Postgres `prisma dev` subcommand) is never actually invoked here.

| Package | Reason |
|---|---|
| `uuid >=11.1.1` | CVE-2026-41907 - buffer bounds check; pinned to `^8.3.2` by `next-auth` |
| `postcss >=8.5.23` | GHSA-r28c-9q8g-f849 - path traversal via `sourceMappingURL`; vendored by `next` |
| `sharp >=0.35.0` | GHSA-f88m-g3jw-g9cj - libvips CVEs; vendored by `next`'s image optimizer |
| `find-my-way >=9.7.0` | GHSA-c96f-x56v-gq3h - HTTP2 DDoS; exact-pinned at `9.6.0` by `@prisma/dev` (only reachable via the `prisma dev` embedded-Postgres subcommand, which this project never runs, but still installed as a non-dev `dependencies` entry) |
| `valibot >=1.4.2` | GHSA-5qjj-4xww-7phc - `flatten()` throws on inherited `Object` property names; exact-pinned at `1.2.0` by `@prisma/dev` |
| `js-yaml >=4.3.0` | GHSA-52cp-r559-cp3m - quadratic-CPU DoS via merge-key chains; pulled in by `eslint`'s `@eslint/eslintrc` |
| `eslint-plugin-react-hooks` pinned to `7.0.1` | Not a CVE fix - its `^7.0.0` range floats onto `7.1.1`, which enables new `react-hooks/purity`/`react-hooks/immutability` rules that fail on pre-existing code unrelated to any dependency bump. Pinned to avoid that scope creep; revisit separately if those rules are worth fixing for real. |
| Nested `@typescript-eslint/typescript-estree` → `minimatch` → `brace-expansion >=5.0.8` and `eslint` → `minimatch` → `brace-expansion >=1.1.16` | GHSA-mh99-v99m-4gvg. A flat top-level `brace-expansion` override breaks `eslint`'s own vendored `minimatch@3.1.5`, which expects the old `brace-expansion` 1.x API (`expand is not a function` otherwise) - hence two scoped overrides instead of one, each keeping the major version its parent expects. |

## Architecture

### File layout

```
app/                  Next.js App Router pages and Server Actions
  generated/prisma/   Prisma client (generated - do not edit)
  globals.css         Design tokens + Tailwind base
  global-error.tsx    Global error boundary (client component, force-dynamic)
components/
  ui/                 Radix UI primitive wrappers - currently button.tsx, dialog.tsx, input.tsx
  (other)             Feature components - dialogs, charts, sync buttons, etc.
lib/
  actions/            Server Actions (all DB mutations go here)
  auth.ts             NextAuth config + in-memory rate limiter
  csv-import.ts       CSV parsing/validation shared by transaction & balance-history importers
  exchange-rate.ts    fetchExchangeRateToEur() - USD/GBP/CHF→EUR via Yahoo Finance
  format.ts           Monetary helpers: cents↔Decimal, formatCurrency, formatPercent
  gocardless.ts       GoCardless API client (token cache, typed fetch helpers)
  institutions.ts     Bank/broker name → favicon domain mapping (used for logos)
  loan.ts             calcCurrentCapital() helper
  markdown-export.ts  Shared export helpers (fmt, sign, downloadFile) for accounts/analytics exports
  palette.ts          Shared color palettes (category swatches, chart colors, avatar colors)
  prisma.ts           Singleton PrismaClient via @prisma/adapter-pg + pg Pool
  recurring.ts        Pure recurring-transaction detection/projection functions
  tax.ts              getAccountTaxRate() - per-account tax rate resolution
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
proxy.ts              Next.js middleware (root) - auth bypass + demo POST-blocking
```

Selfhosted-specific points below.

### Authentication

**Disabled by default** (`AUTH_ENABLED` unset or anything other than `"true"`). Self-hosted = private network, network-level trust is sufficient.

Enabled via `AUTH_ENABLED=true` + `AUTH_PASSWORD` (plaintext) or `AUTH_PASSWORD_HASH` (bcrypt). When enabled: NextAuth Credentials provider, JWT session 30d, rate-limit 5 attempts/15min/IP. Display name via `AUTH_USER_NAME` (defaults to `"owner"`).

`proxy.ts` is the Next.js middleware (at the repo root). It reads `process.env.AUTH_ENABLED` in the `authorized` callback and bypasses NextAuth when it isn't `"true"`. If the upstream `proxy.ts` ever diverges, do **not** blindly overwrite this file.

`sidebar-wrapper.tsx` is a **server component** (no `"use client"`) - reads `AUTH_ENABLED`, passes `showLogout` prop to `sidebar-dynamic.tsx`.
`sidebar-dynamic.tsx` is a **client component** (`"use client"`) - handles `dynamic({ ssr: false })` (required to be in a client component in Next.js 16). This file does not exist in the upstream repo.
Both files are selfhosted-specific and must never be overwritten by the sync script.

For users who want security without built-in auth: document Nginx Proxy Manager, Caddy basicauth, Traefik + Authelia, Cloudflare Access, or VPN (Tailscale).

### i18n

Implemented via `next-intl`. Locale detection order: `NEXT_LOCALE` cookie → `Accept-Language` header → `DEFAULT_LOCALE` env var (defaults to `"fr"`). Supported locales: `fr` (default) and `en`. No URL prefix per locale.

UI strings live in `messages/fr.json` and `messages/en.json`. When adding new strings, update both files. Institution logos are fetched from Google Favicons using domain mappings in `lib/institutions.ts`.

### Demo mode

Set `DEMO_MODE=true` to enable a read-only public demo. `proxy.ts` intercepts all non-GET requests and returns 403. The `<AutoSync />` component on the dashboard is also disabled. Use `docker-compose.demo.yml` for a pre-seeded demo environment.

### GoCardless (Open Banking PSD2)

Optional. EU + UK bank connections via the official PSD2 API (free tier: 50 connections, 90-day history).

Credentials: `GOCARDLESS_SECRET_ID` + `GOCARDLESS_SECRET_KEY`. Set `APP_URL` to the app's public URL when behind a reverse proxy - it's used as the OAuth callback after bank authentication. Leave `APP_URL` blank for localhost use.

GoCardless logic lives in the Next.js app (not the `sync/` service).

### App ↔ Sync service communication

The Next.js app calls the Python sync service via HTTP using `SYNC_SERVICE_URL=http://sync:8000` (set automatically in `docker-compose.yml`). In development, the sync service is not started - only the DB runs via `docker-compose.dev.yml`.

### Sync service - optional modules

The `sync/` service has two dedicated sync modules plus a generic Woob runner:

| Module | Required credentials | Purpose |
|---|---|---|
| `sync_lcl.py` | `LCL_LOGIN`, `LCL_PASSWORD` | LCL (FR) via Woob hardcoded module |
| `sync_tr.py` | `TR_PHONE`, `TR_PIN` | Trade Republic via pytr |
| `sync_woob.py` | Set per-institution in UI | Generic Woob runner for any institution configured in Settings |

Leave credentials blank to disable a module. `sync/main.py` skips gracefully. `sync/db.py` contains shared PostgreSQL helpers - do not duplicate inline.

### Backup & restore

Two paths, both wrap `pg_dump`/`psql` (full DB dump - schema + data, never a hand-rolled Prisma export, to avoid drift and BigInt/Decimal serialization issues):

- **CLI**: `scripts/backup.sh` / `scripts/restore.sh` - call `docker compose exec db pg_dump|psql`. `restore.sh` pauses `app`/`sync` if present and requires typed confirmation.
- **UI**: Settings → Backup & restore (`components/backup-restore-section.tsx`), backed by `app/api/backup/route.ts` (`GET` streams a gzip dump, `POST` restores from an uploaded file, auto-detecting gzip vs plain `.sql`). This runs `pg_dump`/`psql` from inside the `app` container itself - that's why the `runner` stage in `Dockerfile` installs `postgresql16-client` (must track the `postgres:16-alpine` server version; a client older than the server can't dump it). Hidden entirely in `DEMO_MODE` (matches the auto-sync section's pattern).

Both directions use `pg_dump --clean --if-exists` (so restore drops/recreates objects first) and `psql --single-transaction` (restore is all-or-nothing, no partial state on error). Never echo raw `pg_dump`/`psql` stderr to the client - log it server-side and return a generic error message, per the exception-exposure fix in commit `1ae43c0`.

Implementation notes (post-v1.2.0 audit fixes):

- `buildConnectionString()` passes the *whole* `DATABASE_URL` (password stripped, everything else - including query params like `?sslmode=require` - intact) as a single positional arg to `pg_dump`/`psql`, with the password supplied separately via `PGPASSWORD`. Don't go back to manually extracting `host`/`port`/`user`/`database` into separate `-h`/`-p`/`-U`/`-d` flags - that approach silently drops any connection query params.
- The `GET` handler's `ReadableStream` only closes successfully once **both** `gzip`'s `"end"` (all bytes flushed) and `pg_dump`'s `"close"` (exit code known) have fired, and only if the exit code was `0`. A pg_dump that dies mid-dump after already writing valid-looking output must **error**, not silently succeed - a truncated "successful" backup is far worse than a visibly failed download, since the corruption would otherwise only surface during an actual restore. The `settled` flag guards every controller call this can race with (`enqueue`, `close`, `error`) - including `cancel()`, which must also set it (a client aborting mid-download must not let a still-queued `gzip.on("data")` callback call `enqueue()` on an already-cancelled stream and crash the process).
- After a successful restore, the process calls `process.exit(0)` (gated to `NODE_ENV === "production"`, so local `npm run dev` isn't killed) so the container's `restart: unless-stopped` policy hands the app a fresh Prisma connection pool - the restore just dropped and recreated the whole schema out from under any pooled connections' cached query plans, the same reason `scripts/restore.sh` stops the `app` container before restoring. `components/backup-restore-section.tsx` polls the current page with a `HEAD` request (never `/api/backup` - that would trigger another full `pg_dump`) until the app responds again before reloading.

### CSV import (transactions & balance history)

For fiat accounts (`CHECKING`/`SAVINGS`/`MEAL_VOUCHER`) not covered by auto-sync - gated by `canImportCsv = isFiat && !isSynced && !account.gocardlessAccountId` in `app/accounts/[id]/page.tsx`. Two independent entry points, both rendered wherever that condition holds:

- **Transactions** - `components/import-transactions-dialog.tsx` + `lib/actions/transactions.ts`'s `importTransactions(accountId, rows)`. Writes `Transaction` rows.
- **Balance history** - `components/import-balance-history-dialog.tsx` + `lib/actions/balances.ts`'s `importBalanceHistory(accountId, rows)`. Writes `HistoricalBalance` rows at noon UTC (`${date}T12:00:00.000Z`, same convention as `prisma/seed-demo.ts` - avoids a midnight-UTC day shift in negative-offset timezones). Because the dashboard's net-worth-over-time chart (`app/page.tsx`) is built by aggregating `HistoricalBalance` across every account grouped by day, backfilling this way also backfills that chart - no separate "net worth snapshot" model exists or is needed.
  - Deliberately **not** offered for `LOAN` (its balance is computed at runtime via `calcCurrentCapital()`, never stored - importing a raw balance would double as a false asset in the dashboard aggregation, which doesn't know to treat it as a liability) or for `INVESTMENT`/`CRYPTO`/`REAL_ESTATE`/`AUTOMOBILE` (their current-value source of truth is holdings+live price or `manualValueCents`, not the latest `HistoricalBalance` row - importing snapshots there would create a chart whose last point silently disagrees with the value shown in the account header). Fiat accounts are the one type where `HistoricalBalance` is already the authoritative source for both current value and chart history, so there's no such discontinuity risk.

Shared design across both importers:

- CSV parsing, date parsing, header aliasing, and validation live in `lib/csv-import.ts` (`parseCsvDate`, `isFutureDate`, `looksNumeric`, `makeHeaderNormalizer`) - shared by both dialog components so a fix in one place reaches both importers. Parsing and duplicate detection happen **entirely client-side** - no server round-trip until the user confirms. Header aliases (French: `libellé`/`montant`/`solde`/`valeur`) and both `YYYY-MM-DD`/`DD/MM/YYYY` date formats are accepted.
- `looksNumeric()` rejects non-numeric-but-non-empty values (`"N/A"`, `"#REF!"`, `"3.5abc"`) before they reach `parseCents()` - `parseCents()` itself falls back to `0` on `NaN` (a deliberate leniency other callers, like the settings tax-rate inputs, rely on), so without this guard a garbage CSV cell would silently import as a real €0.00 row instead of being flagged.
- `isFutureDate()` rejects balance-history rows dated after today (UTC) - without it, a typo'd date (e.g. `2062` instead of `2026`) would become the account's displayed "current balance" everywhere (`app/page.tsx`, `app/accounts/[id]/page.tsx` both take `history[0]` ordered by `recordedAt desc`), with no delete UI to undo it. Transactions don't get this check - nothing reads "the most recent transaction" as a current-value source, so a future-dated transaction isn't a correctness bug the way a future-dated balance is.
- Both `importTransactions` and `importBalanceHistory` call `lib/actions/csv-import-guard.ts`'s `assertCsvImportEligible(accountId)` before writing anything - it re-derives the same eligibility rule as the page's `canImportCsv` (fiat type, not synced, no `gocardlessAccountId`). **Do not remove this** even though the UI already hides the import buttons for ineligible accounts: Server Actions are directly invocable regardless of what's rendered, and this is the only thing stopping a stale page or a future call site from writing CSV data onto a `LOAN`/`INVESTMENT`/synced account.
- "Duplicate" is advisory, not a hard constraint - flagged rows are unchecked by default but the user can still import them. Transactions: flagged when `date|label|amountCents` matches an existing `Transaction` for that account. Balance history: flagged when a `HistoricalBalance` already exists for that exact date. There is no hash-based auto-merge for transactions specifically, because two legitimately different transactions can share a fingerprint (e.g. two identical recurring debits on the same day) - auto-merging on content hash would silently drop one.
- Existing-row fingerprints/dates are computed server-side in the page and passed down as plain `string[]` props - never pass `BigInt` values to a Client Component, following the same "no BigInt across the RSC boundary" rule as `components/export-accounts-button.tsx`.
- Every imported `Transaction`/`HistoricalBalance` row is stored at **noon UTC** (`${date}T12:00:00.000Z`), not midnight - both importers must agree on this (they didn't originally: `importTransactions` used midnight, causing a one-day shift on negative-UTC-offset deployments that `importBalanceHistory` didn't have). Midnight UTC is one keystroke away from reintroducing that bug - don't "simplify" it back to `new Date(r.date)`.
- Every imported `Transaction` gets a fresh `syncId` (`csv_` + `randomUUID()`); neither importer attempts idempotent re-import matching like the Woob/GoCardless sync paths do with their own bank-provided IDs. Re-importing the same file twice creates duplicates - that's what the client-side duplicate flagging is for.

### Recurring transactions

`/recurring` - subscriptions, bills, and regular income, with auto-detection, cash-flow projection, and missed-payment flagging. All the math lives in `lib/recurring.ts` (pure functions, no DB calls, mirrors `lib/loan.ts`'s "params in, computed stats out, `asOf`-dated" shape) so it stays testable in isolation from the page that calls it.

- **Detection** (`detectCandidates`) groups the last 25 months of `Transaction` rows by `(accountId, normalizeLabel(label))` - **per-account, not cross-account**, because `label` is raw bank-feed text specific to one institution's formatting; matching similar-looking labels across two different accounts risks a false merge in a way `Category` (a deliberately account-independent concept) doesn't. A group needs `MIN_OCCURRENCES = 3+`, at least 70% of its amounts within a median±tolerance band (`10%` of the median or a `5€` floor, whichever is larger - a flat 10% would be too tight for small subscriptions and a unanimous match would false-negative on one bonus month or one price change), and a median day-gap (not average - a single skipped/duplicated occurrence skews an average) landing in a frequency band (weekly 6–8d, monthly 27–33d, yearly 350–380d). The 25-month window is deliberate: a yearly pattern needs ~2 years of history before 3 occurrences exist to detect from, so anything shorter silently kills yearly detection. Detection only ever proposes `intervalCount = 1` - inferring "every 2 months" cadences from noisy gaps is out of scope; fix it via the manual edit dialog instead.
- Confirmed/paused/dismissed all live in the same `RecurringTransaction` row via `active`+`autoDetected` - dismissing a suggestion creates a row with `active: false, autoDetected: true` (`dismissSuggestion` in `lib/actions/recurring.ts`) purely so its `(accountId, normalizeLabel(label))` key is excluded from future detection passes; there's no way to distinguish "paused after being active" from "never-confirmed dismissal" in storage, and the UI doesn't try to - both just show a "Paused" badge with a Resume action.
- **Missed-payment check** (`isMissed`) only ever looks at the single most recent expected occurrence, not every occurrence since `anchorDate` - walking full history would flag a subscription cancelled 2 years ago as "missed" every month forever. `DEFAULT_GRACE_DAYS = 5` window, same amount-tolerance formula as detection.
- **Cash-flow projection** (`projectDailyCumulative`) is a *relative* running total starting at 0 over the next 90 days - deliberately not tied to actual account balances or the real net-worth calculation, to avoid conflating this with `UserSettings.salaryNetCents`/`monthlyExpensesCents` (the Analytics page's Runway/Savings-Rate cards have their own manual-entry semantics that this feature must not silently overwrite or duplicate). `components/cashflow-chart.tsx` renders this with Recharts `Area type="stepAfter"` (not `"monotone"`, copied from `net-worth-chart.tsx`'s scaffold otherwise) - the cumulative total is a step function that jumps on occurrence days, and smooth interpolation between 90 daily points would draw a misleading ramp.
- Month-stepping (`addMonthsClamped` in `lib/recurring.ts`) clamps to the last day of shorter months (anchor on the 31st → lands on Feb 28/29) - `lib/loan.ts`'s `endDate.setMonth(...)` pattern does NOT do this (native `Date` overflows instead of clamping, e.g. Jan 31 + 1 month rolls to Mar 3) and must not be copied here.
- Dates use the noon-UTC convention (`${dateStr}T12:00:00.000Z`) throughout, same as CSV import - `anchorDate` must line up day-for-day against real `Transaction.date` values for missed-payment matching to work.

### Interest & dividend income tracking

`/income` - manually-recorded `IncomeEvent` rows (`DIVIDEND` or `INTEREST`, optional `ticker`, gross `amountCents`, optional `taxWithheldCents` for foreign withholding tax, `date`). This is a real, user-entered record, distinct from the estimate described below - nothing here is auto-synced or auto-detected.

- Net amount is always computed as `amountCents - (taxWithheldCents ?? 0)`, never stored. `ticker` is free text (not a FK to `Holding`) so a sold position's dividend history survives the holding being deleted.
- The Analytics page's "Passive income" card shows real year-to-date `IncomeEvent` totals (dividends/interest, net of withholding) with a link to `/income` - **this replaced an estimate** that used a hardcoded `DIVIDEND_YIELDS` map and unauthenticated Yahoo Finance dividend-history fetches, plus French regulated-savings rates matched by account **name substring** (`"livret a"`, `"ldds"`, etc.).
- That estimate machinery (`DIVIDEND_YIELDS`, `ISIN_TO_YF_SYMBOL`, `fetchYFDividendForSymbol`, the name-matched savings rates in `app/analytics/page.tsx`) is **not removed** - it still feeds the separate "Dividend calendar" section (upcoming per-holding ex-dividend dates), a genuinely different, forward-looking concept that this feature doesn't replace. Don't confuse the two `taxRate` variables in that file: `dividendEffectiveTaxRate()` is dividend withholding tax (ISIN country + `investmentSubtype`-based), unrelated to the latent capital-gains tax described below.

### Tax treatment

Latent (unrealized capital-gains) tax is a **per-account** setting, not a global one: `Account.taxTreatment` (`TaxTreatment` enum: `EXEMPT` | `DEFERRED` | `TAXABLE`) + `Account.taxRatePct` (0-1 ratio, meaningful only when `TAXABLE`). `lib/tax.ts`'s `getAccountTaxRate(account)` is the single shared resolver - `EXEMPT`/`DEFERRED` both return `0`, `TAXABLE` returns `taxRatePct` - used by all four pages that compute latent tax (`app/page.tsx`, `app/accounts/page.tsx`, `app/accounts/[id]/page.tsx`, `app/analytics/page.tsx`), replacing 4 previously-duplicated `account.type`/`investmentSubtype` branching helpers.

- This exists so non-French wrappers have somewhere to go: a UK ISA or US Roth IRA is `EXEMPT`, a PER/401k is `DEFERRED` (not taxed until withdrawal - not taxed for latent/net-worth purposes today either), anything else is `TAXABLE` at whatever rate the user enters. `investmentSubtype` (`"PEA"`/`"CTO"`, cosmetic label only) is fully decoupled from this - an ISA doesn't need to pretend to be a "CTO" to get taxed correctly.
- Set at account creation (`components/add-account-dialog.tsx` + `createAccount`, rate pre-filled with a hardcoded 17.2%/31.4% suggestion based on the PEA/CTO/Crypto choice, always editable) or afterward via an inline form in the account detail page's fiscal summary (`updateAccountTaxTreatment` in `lib/actions/accounts.ts`, same `<form action={...}>` pattern as `updateInvestmentStartDate`) - there was no prior UI to edit `investmentSubtype` post-creation either, so this is the first edit surface for either field.
- `UserSettings.taxRatePea`/`taxRateCto`/`taxRateCrypto` (Settings → Fiscalité) still exist, but only as **defaults offered when creating a new account** - they are no longer read per-render for existing accounts. Migration `20260727141819_add_account_tax_treatment` backfilled every pre-existing account's `taxRatePct` from these same global rates at the time it ran, so upgrading never changes a displayed number: CRYPTO → `taxRateCrypto`, PEA → `taxRatePea`, CTO → `taxRateCto`, INVESTMENT with no subtype set → `EXEMPT` (reproducing the old chain's `null` = "no tax computed" outcome exactly, not a claim that the account is a real tax-exempt wrapper).

### Realized gains & annual tax report

Before this feature, selling a holding meant retyping a smaller `quantity`/`costBasisCents` on the existing `Holding` row (`upsertHolding` in `lib/actions/holdings.ts`) - a blind overwrite with no history, no gain ever computed. `Sale` (`ticker`, `quantity` sold, `proceedsCents`, `costBasisCents` of the *sold portion*, `date`) now records disposals as discrete events, the same shape as `IncomeEvent`. Realized gain is always `proceedsCents - costBasisCents`, never stored.

- **Recording a sale** (`components/sell-holding-dialog.tsx`, "Sell" button next to each holding row in `app/accounts/[id]/page.tsx`) uses the **average-cost method**, not per-lot FIFO/LIFO: the sold portion's cost basis defaults to `holding.costBasisCents * (soldQty / holding.quantity)`, always user-editable. `recordSale` (`lib/actions/sales.ts`) wraps creating the `Sale` row and adjusting the `Holding` in one `prisma.$transaction` - full disposal (`quantitySold >= holding.quantity`) deletes the `Holding`, partial disposal reduces `quantity` and `costBasisCents` proportionally, then calls the same `refreshAccountBalance` helper `upsertHolding`/`deleteHolding` already use (exported from `lib/actions/holdings.ts` for this reason).
- **No backfill and no `updateSale`**: past sales already lost to the old overwrite behavior can't be reconstructed, and editing a past `Sale`'s quantity/proceeds after the fact would need the same retroactive-holding-adjustment problem `deleteSale` already punts on (**record-only deletion** - it does not reverse the `Holding` change, since the holding may have had further buys/sells/price updates since; correcting a mistake means deleting the `Sale` row *and* manually fixing the `Holding` via the existing edit dialog).
- **`/tax-report`** aggregates `Sale` + `IncomeEvent` for a given calendar year (`?year=` search param). Estimated tax on gains reuses `getAccountTaxRate()` from "Tax treatment" above (`EXEMPT`/`DEFERRED` sales show €0 tax, same semantics as latent tax elsewhere) - it does not attempt to model additional income tax on dividends/interest beyond what `IncomeEvent.taxWithheldCents` already nets out, by design (country-agnostic scope, not a French PFU/social-charges calculator). No sidebar nav item - linked instead from the Analytics "Passive income" card and the account detail page's fiscal summary, to avoid further crowding the already-7-item mobile bottom nav.
- Markdown export (`components/export-tax-report-button.tsx`) reuses `lib/markdown-export.ts`'s `fmt`/`sign`/`downloadFile`, same convention as `export-analytics-button.tsx`/`export-accounts-button.tsx` - this is the "country-agnostic, exportable" part of the roadmap wording; the report itself is presented as an estimate for informational purposes, not an official tax document or a literal French IFU form mapping.

### Benchmark comparison

`app/analytics/page.tsx`'s "Comparaison aux indices" section, right after the investment performance table. Deliberately **not** a historical overlay chart: `investCAGR` (the portfolio's own aggregate CAGR, see the performance table above it) is itself a point-in-time snapshot - current value vs. cost basis, annualized over a cost-basis-weighted average holding duration (`investCAGRWeightedYears`) - not a smooth time series (investment `HistoricalBalance` snapshots are event-driven, created only when holdings change, not on a schedule, so there's no reliable daily series to chart against an index). This feature applies the identical snapshot-to-snapshot methodology to 3 reference indices instead of inventing a different, inconsistent one.

- `fetchYFPriceHistory(symbol)` reuses the exact same unauthenticated Yahoo chart endpoint, headers, and `next: { revalidate: 3600 }` caching as the existing dividend fetch (`fetchYFDividendForSymbol`) - that endpoint already returns OHLC `close`/`timestamp` arrays that the dividend fetch just discards (it only reads `events.dividends`/`meta.regularMarketPrice`); this fetch reads those arrays instead, with `interval=1mo&range=10y` and no `events` param.
- `BENCHMARK_SYMBOLS`: `sp500: "^GSPC"`, `cac40: "^FCHI"` (real index tickers), `msciWorld: "URTH"` (the iShares MSCI World ETF - Yahoo has no clean "^" ticker for the real index, so this is a proxy with a small expense-ratio drag, disclosed in the UI footnote).
- `computeIndexCAGR(series, startDate, now)` finds the closest historical close to `startDate` (via `priceAt`, nearest-timestamp match - the fetched series is monthly, not daily) and to `now`, then applies the same `(end/start)^(1/years) - 1` formula as `investCAGR`, over the identical `investCAGRWeightedYears` lookback so the comparison is apples-to-apples.
- Only rendered when `investCAGR !== null` (same gate as the aggregate CAGR itself) and per-index only when that index's fetch actually returned data (Yahoo being unreachable degrades to that one row being omitted, not a crash - same `try/catch` → empty-array fallback as the dividend fetch).

### Portfolio rebalancing

`Holding.targetPct` (0-1 ratio, nullable - same convention as `taxRatePct`) adds a target counterpart to the per-holding "Poids" (current weight) column that already existed on `app/accounts/[id]/page.tsx`'s holdings table (`pct = marketValueCents / accountTotal`). This is scoped **within one account's own holdings** - unrelated to the Analytics allocation chart, which only buckets by account *type* (cash/savings/investments/crypto/realEstate/auto), never per-ticker.

- Set via the existing `components/add-holding-dialog.tsx` edit form (one more optional field, not a new dialog), input as a 0-100 percentage and converted to a 0-1 ratio in `upsertHolding` (`lib/actions/holdings.ts`). Same optional-update semantics as `costBasisCents`: leaving it blank on an edit does not clear a previously-set target.
- Targets are **not required to sum to 100%** - a holding with `targetPct: null` is simply excluded from the rebalancing plan (e.g. an untouched legacy position the user doesn't want to manage this way).
- The "Rééquilibrage" section on the account detail page (only shown when at least one holding has a target set) computes, per targeted holding: drift in points (`pct - targetPct*100`) and a suggested trade (`driftValueCents = marketValueCents - accountTotal*targetPct`; positive → suggest selling that amount, negative → suggest buying it), plus an approximate share count from `driftValueCents / lastPriceCents`.
- **Informational only** - the suggestion is displayed as text, not wired to pre-fill `AddHoldingDialog`/`SellHoldingDialog` (neither currently accepts external suggested-quantity props, and both are already one scroll up in the same holdings table for the user to act on manually). Keeps this change to one field + one read-only section, no changes to two already-working dialogs' APIs.

### Multi-currency

`Holding` positions can be entered in USD, GBP, or CHF and are converted to EUR **once, at entry time** - `lastPriceCents`/`costBasisCents` stay exactly what they've always been (plain EUR cents), so every existing calculation (net worth, tax, rebalancing, the tax report, the 3 chart components) keeps working completely unmodified. This is deliberately narrower than a "live multi-currency ledger": holdings aren't live-refreshed today either except via sync, so a snapshot-on-entry FX rate matches the app's existing "manually update the price when you check in" paradigm.

- `lib/exchange-rate.ts`'s `fetchExchangeRateToEur(currency)` reuses the same unauthenticated Yahoo Finance chart endpoint/headers/`revalidate: 3600` caching convention as the dividend/benchmark fetches in `app/analytics/page.tsx`, via the `EURUSD=X`/`EURGBP=X`/`EURCHF=X` pairs (Yahoo quotes these as "X per 1 EUR", so the raw price is inverted to get "EUR per 1 X"). Extracted to `lib/` rather than kept page-local since it's the first Yahoo fetch called from a Server Action rather than a page.
- `upsertHolding` (`lib/actions/holdings.ts`) reads `currency` from the form (default `"EUR"`, unchanged path - the 3 new fields stay `null`). For a foreign currency, it fetches the rate and **throws if the rate can't be fetched** - no silent fallback to a stale/wrong rate - then stores `nativePriceCents`/`nativeCostBasisCents` (exactly what the user typed) and `fxRateToEur` (the rate captured at entry time) alongside the EUR-converted `lastPriceCents`/`costBasisCents`. Switching a holding's currency back to EUR on an edit nulls out all three native fields.
- `components/add-holding-dialog.tsx`'s price/cost-basis inputs pre-fill from `nativePriceCents`/`nativeCostBasisCents` when set (not `lastPriceCents`) so re-opening the edit dialog on a foreign-currency holding shows back exactly what was typed (e.g. "150.00"), not a lossy back-converted approximation.
- The holdings table (`app/accounts/[id]/page.tsx`) shows a small muted currency-code badge next to the ticker (e.g. "AAPL · USD") when `currency !== "EUR"` - no new table column, to avoid the mobile-width concerns already worked through for this same table (see "Portfolio rebalancing" above).

### Data model

- `Institution` → many `Account`
- `Account` (`AccountType`: `CHECKING | SAVINGS | INVESTMENT | REAL_ESTATE | MEAL_VOUCHER | CRYPTO | AUTOMOBILE | LOAN`)
  - Fiat (CHECKING, SAVINGS, MEAL_VOUCHER): `HistoricalBalance` (balance in cents as `BigInt`)
  - Investment/Crypto: `Holding` (ticker + `Decimal` quantity) + live price at runtime. `investmentSubtype` = `"PEA"` or `"CTO"` (cosmetic label only). `taxTreatment` (`TaxTreatment` enum) + `taxRatePct` drive the actual latent-tax rate - see "Tax treatment" below
  - Real Estate & Automobile: `manualValueCents` + optional `liabilityCents`
  - LOAN: capital computed at runtime via `calcCurrentCapital()` from `lib/loan.ts`
- `Holding` - unique on `(accountId, ticker)`. `costBasisCents` for P&L. `targetPct` (0-1 ratio, nullable) drives the "Portfolio rebalancing" feature below - independent of any other field. `currency` (`HoldingCurrency` enum, default `EUR`) + `nativePriceCents`/`nativeCostBasisCents`/`fxRateToEur` (all null when `currency = EUR`) drive "Multi-currency" below - `lastPriceCents`/`costBasisCents` are always EUR regardless of `currency`
- `HistoricalBalance` - daily balance snapshots
- `Transaction` - bank movements. `amountCents`: positive = credit, negative = debit. Deduplicated via `syncId`. Optional `categoryId` → `Category` (`onDelete: SetNull` - deleting a category un-categorizes its transactions instead of deleting them)
- `Category` - user-defined spending category (name, hex `color`, optional `budgetCents`). `budgetCents` is a single ongoing monthly envelope, not a per-month history - editing it takes effect immediately, including retroactively on the current month's progress bar (no historical record of past amounts). `/budgets` computes each category's current-calendar-month spend via `prisma.transaction.groupBy({ by: ["categoryId"] })` filtered to `amountCents < 0` (debits only) - a `categoryId: null` bucket in that same query is the "uncategorized spend" figure. Clicking a category name links to `/budgets/[categoryId]`, a drill-down page listing every transaction (across all accounts) tagged with it, reusing `TransactionCategorySelect` so a mis-tagged row can be recategorized in place.
  - **Bulk categorization**: `/budgets` also lists the top `MAX_UNCATEGORIZED_GROUPS` (8) uncategorized-transaction label groups by total absolute spend (`components/uncategorized-group-card.tsx`, grouped in-memory by `normalizeLabel()` from `lib/recurring.ts` - same normalization the recurring-detection heuristic uses, since it's the same "same real-world thing, different bank-feed casing" problem). `bulkAssignCategory(transactionIds, categoryId)` in `lib/actions/transactions.ts` sets one category on an arbitrary batch of transaction ids in one `updateMany` - the ids come from a server-computed group, never from client-supplied label matching, so there's no risk of a stale/forged id list touching the wrong rows.
  - Recurring-suggestion candidates (`detectCandidates` in `lib/recurring.ts`) carry a `categoryId` guess: the majority (mode) category already assigned among the matched transactions, if any. This is why confirming a long-standing subscription's suggestion often needs no manual category pick - it's inherited from however you'd already tagged that label's past transactions, not re-guessed from scratch.
- `RecurringTransaction` - a subscription/bill/regular-income template (`label`, signed `amountCents`, `frequency` enum `WEEKLY|MONTHLY|YEARLY`, `intervalCount`, `anchorDate`, optional `categoryId`). `active: false` means either user-paused or a dismissed auto-detection suggestion - both states are excluded from projections and from resurfacing as a suggestion (see below), there's no separate "dismissed" table
- `IncomeEvent` - a real, manually-recorded dividend or interest payment (`type` enum `DIVIDEND|INTEREST`, optional `ticker`, gross `amountCents`, optional `taxWithheldCents`, `date`). See "Interest & dividend income tracking" below - distinct from the Analytics page's separate Yahoo-Finance-based dividend/interest *estimate*.
- `Sale` - a recorded disposal of part or all of a `Holding` position (`ticker`, `quantity` sold, `proceedsCents`, `costBasisCents` of the sold portion, `date`). See "Realized gains & annual tax report" below - realized gain is `proceedsCents - costBasisCents`, never stored.
- `SyncLog` - per-run log entries: `source` ("lcl" | "trade_republic"), `status` ("success" | "error" | "auth_required"), optional `message`
- `UserSettings` - singleton (`id = "singleton"`): salary, expenses, savings goal, monthly saved, `taxRatePea`/`taxRateCto`/`taxRateCrypto` (Float, defaults 0.172/0.314/0.314) - now only defaults suggested when creating a new account, see "Tax treatment" below

### Net worth calculation

**Gross = fiat balances + holdings market value + real estate/automobile manualValueCents**
**Net = Gross − liabilityCents − loan remaining capital − latent taxes**

Latent tax rate: per-account via `getAccountTaxRate()` - see "Tax treatment" above. `UserSettings`'s PEA/CTO/Crypto rates (Settings → Fiscalité) are only the defaults suggested when creating a new account.

### Prisma client

This project uses **Prisma 7** with the `@prisma/adapter-pg` driver adapter (not the legacy built-in engine). `lib/prisma.ts` creates the client via a `pg.Pool` → `PrismaPg` adapter. Always import `prisma` from `@/lib/prisma` - never instantiate `PrismaClient` directly. The client is a module-level singleton (cached on `globalThis` in dev to survive HMR).

The client is generated to `app/generated/prisma` (gitignored, never committed). `npm install` runs it automatically via the `postinstall` script; re-run `npx prisma generate` manually after editing `schema.prisma` without reinstalling. In `Dockerfile`, the `deps` and `runner` stages run `npm ci` with `--ignore-scripts` because `prisma/schema.prisma` isn't copied into those stages yet - the `builder` stage generates the client explicitly once the full source is present.

### Server vs Client boundary

- All Prisma queries and third-party API calls **must** live in Server Components or Server Actions.
- Chart and interactive UI components are `"use client"`. Pass pre-fetched data as props.

### Amounts & precision

All monetary values stored as **integer cents** (`BigInt`). Arithmetic via `Decimal.js`. Use helpers from `lib/format.ts` for conversion and display (do not inline formatting logic). Institution logos are fetched at runtime via Google Favicons using domain mappings in `lib/institutions.ts` - add new institutions there, not inline.

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
