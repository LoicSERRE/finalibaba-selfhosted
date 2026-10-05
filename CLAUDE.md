# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Detailed design notes, incident write-ups and per-release audit results live in `dev-docs/` (see the index at the end). This file keeps only what applies to most tasks; open the matching `dev-docs/` file before touching a feature area.

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

The script's `rsync --exclude` list is the source of truth for what never gets synced - it covers infra files (`.github/`, all `docker-compose*.yml`, `env.server.example`, `.env*`), selfhosted-only docs (`CLAUDE.md`, `dev-docs/`, `README.md`, `ROADMAP.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `LICENSE*`), demo/mock seed files (`prisma/seed-demo.ts`, `prisma/seed-tr-mock.ts`), and `scripts/`, `.claude/` themselves. The files below additionally need protection because they *do* exist upstream but must keep selfhosted-specific content:

Files that must **never** be overwritten by the sync script:

| File | Reason |
|---|---|
| `proxy.ts` | Selfhosted version has conditional auth - may diverge from upstream |
| `components/layout/sidebar-wrapper.tsx` | Server component reading `AUTH_ENABLED` - selfhosted-specific |
| `components/layout/sidebar-dynamic.tsx` | Selfhosted-only file, does not exist in upstream |
| `app/api/gocardless/institutions/route.ts` | Selfhosted-only file (dynamic country/bank search backing `connect-open-banking-dialog.tsx`), does not exist in upstream - `--delete` would otherwise remove it since it has no upstream counterpart |
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

pnpm only (version pinned by `packageManager`, resolved via corepack).

```bash
pnpm dev                                   # Dev server, http://localhost:3000
NODE_ENV=production pnpm run build         # Prod build = the type-check (NODE_ENV=production REQUIRED)
pnpm run lint                              # ESLint (includes eslint-plugin-sonarjs)
pnpm test                                  # Vitest, everything under __tests__/
pnpm test __tests__/alerts.test.ts         # Single file
pnpm test -- -t "name substring"           # Filter by test name
pnpm run test:coverage                     # Coverage - trust the json-summary, not the terminal table
pnpm run verify                            # lint + prod build + test:coverage (run before any commit)
```

Local DB (credentials fixed in `docker-compose.dev.yml`):
```bash
docker compose -f docker-compose.dev.yml up -d
# DATABASE_URL=postgresql://appuser:devpassword@localhost:5432/finalibaba
pnpm exec prisma migrate deploy           # first time only
pnpm run db:seed:demo                     # optional - WIPES data, seeds fictional accounts
SEED_MULTIUSER_PASSWORD=<8+ chars> pnpm run db:seed:multiuser   # optional, additive: a member + co-ownership + grant
```

Prisma: `pnpm run db:migrate -- --name <name>` (create + apply), `pnpm exec prisma generate` (after schema edits; also runs on `postinstall`), `db:seed` (reference institutions), `db:push`, `db:studio`. Never squash migrations - it breaks every existing install with P3018 (see `dev-docs/platform.md`).

Production: `cp .env.example .env && docker compose up -d`. `pnpm run docker:dev` actually runs the default `docker-compose.yml`; `docker:prod`/`docker:prod:stop` are BROKEN (no `docker-compose.prod.yml` here).

Python sync service (`sync/`):
```bash
ruff check sync/
cd sync && python -m pytest
# Coverage for SonarQube - from the REPO ROOT, otherwise paths don't resolve:
python -m pytest sync/tests -c sync/pytest.ini --cov=sync --cov-report=xml:sync/coverage.xml
```
DB-backed Python tests (e.g. `test_db_ownership.py`) skip unless `DATABASE_URL` is set.

Component-rendering tests are opt-in per file with `// @vitest-environment happy-dom` on line 1. Mock `useTranslations` so it ECHOES interpolation values, never `(key) => key`. Testing detail and known coverage gaps: `dev-docs/testing.md`.

## Pre-commit pipeline

Mirrors `ci.yml`; run cheapest first. Full text in `dev-docs/release-audit.md`.

1. `git status` + `git diff --check` (conflict markers, whitespace).
2-4. `pnpm run verify`. Pipe builds with `set -o pipefail` - `pnpm run build | tail` hides a failing exit code.
5. If `sync/` changed: ruff + pytest (above).
6. If `prisma/` changed: `prisma migrate deploy` into an EMPTY DB, then `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` (catches data-only migrations that should have changed a default).
7. SonarQube (local, not in CI): quality gate green with **zero new issues**; accepted exceptions are already in `sonar-project.properties`.
8. If lockfiles/`sync/requirements.txt` changed: `pnpm audit --prod --audit-level=high` and `pip-audit -r sync/requirements.txt`. Read `dev-docs/dependencies.md` before adding/removing a `pnpm-workspace.yaml` override (they are security fixes).

At each version boundary also run the 7-point release audit in `dev-docs/release-audit.md` (layering both directions, `lizard -w .` + `scripts/lizard-blind-spots.py`, JS+Python coverage, recurring-bug patterns, doc drift, dependency health, every `quality.yml` scanner's actual counts).

## Architecture

### File layout

```
app/                  Next.js App Router pages and Server Actions - routing is tied to this
                      folder by framework convention, so it's the one place that can't be
                      reorganized by technical concern (DB/API/front) without breaking routes
  api/                Route Handlers - sync/alerts webhooks, set-locale/set-theme, backup,
                      GoCardless OAuth callback, and the versioned public REST API (v1/*,
                      see `dev-docs/multi-user-and-security.md`) - everything else in this tree is a page
  generated/prisma/   Prisma client (generated - do not edit)
  globals.css         Design tokens + Tailwind base (dark palette + opt-in light override)
  global-error.tsx    Global error boundary (client component, force-dynamic)
  site.webmanifest/   PWA manifest as a Route Handler, NOT the app/manifest.ts file
                      convention - it has to carry crossOrigin="use-credentials", which the
                      convention's auto-linked tag cannot (see `dev-docs/sync-service.md`)
components/          Grouped by feature domain, mirroring the app/ route it belongs to
  ui/                Radix UI primitive wrappers - button.tsx, dialog.tsx, input.tsx
  accounts/          Accounts list page (tabs, add/update/delete dialogs)
  account-detail/    Single-account page (holdings, sales, CSV import, rebalancing)
  analytics/         /analytics page sections
  recurring/         /recurring page (add/toggle dialogs, cashflow chart, suggestions)
  income/            /income page
  budgets/           /budgets page (categories, uncategorized-spend grouping)
  transactions/      /transactions page (global cross-account ledger filters)
  settings/          /settings page (institutions, sync status, backup/restore, i18n)
  dashboard/         Dashboard-only pieces (/ page) - dashboard-loading.tsx is the one exception, reused by app/shared/[token]/loading.tsx since that route renders the same DashboardView shape
  layout/            App shell rendered on every page - sidebar, auto-sync bootstrap
  auth/              Login form (signIn/signOut are dynamically imported where needed, no SessionProvider)
  shared/            Used by 2+ domains above - charts, exports, generic dialogs/buttons
lib/
  actions/            Server Actions (all DB mutations go here)
  db/                 prisma.ts - singleton PrismaClient via @prisma/adapter-pg + pg Pool
  services/           External API clients: gocardless.ts, exchange-rate.ts, yahoo-finance.ts;
                      realtime-bus.ts is the one exception (in-process pub/sub, no external API)
  domain/             Pure business logic (no I/O): tax.ts, loan.ts, recurring.ts, csv-import.ts,
                      analytics.ts, dashboard.ts, account-detail.ts, accounts-page.ts,
                      institutions.ts (bank/broker name → favicon domain mapping)
  utils/              Generic helpers: format.ts, palette.ts, markdown-export.ts
  auth.ts             NextAuth config + in-memory rate limiter
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
  sync_tr_realtime.py Optional persistent listeners (TR_REALTIME_ENABLED), one
                      per Trade Republic connection - see `dev-docs/sync-service.md`
  sync_woob.py        Generic Woob runner for user-configured institutions
  setup_lcl.py        Interactive first-time LCL setup
  setup_tr.py         Interactive first-time Trade Republic setup
public/               Static assets - sw.js (service worker, see `dev-docs/platform.md`) is the one file here that isn't just an image/icon
proxy.ts              Next.js middleware (root) - auth bypass + demo POST-blocking
```

Also in `sync/`: `setup_woob.py` / `setup_tr_institution.py` (per-institution interactive setup), `woob_errors.py` (ordered Woob exception classification), `crypto_at_rest.py` (Python mirror of `lib/domain/crypto-at-rest.ts`), `setup_locks.py`, `realtime_supervisor.py`. `scripts/` holds operator tools (backup/restore, dry-run-by-default data fixes, `audit-bank-modules.py`, `sync-from-upstream.sh`).

### Rules that span many files

Each of these was learned from a real incident; the linked doc has the story.

- **Multi-user, one owner row** (`dev-docs/multi-user-and-security.md`). A fixed `OWNER_USER_ID` row always exists; with `AUTH_ENABLED` unset everything resolves to it, so there is no `userId | null` branching anywhere. `baseAccountIds(userId)` (own + co-owned) is the only set allowed to back derived artifacts (share links, API keys, alerts, exports, transfer detection); `viewAccountIds`/`getViewContext()` (`lib/auth-context.ts`) are for page **reads** only and include read-only portfolio grants. Mutations never use the view context.
- **Server Actions are public endpoints.** Guard every mutation with `assertOwned`/`assertAccountWritable`/`assert*Eligible` even if the UI hides the button. Never export a `"use server"` function that takes a `userId` parameter - it is an impersonation primitive (move such logic to a plain `lib/services/` module). `assertOwned` throws the same "Not found." for missing and foreign rows.
- **A failed identity lookup must deny or narrow, never widen** (e.g. `DeletedSessionUserError` instead of falling back to the owner). Never give a "can be asked about a user" function an owner-shaped default.
- **Expected Server Action failures are returned, not thrown** - production replaces thrown messages with an opaque digest. Return `{ ok: false, error: "<stable_key>" }` and translate in the UI; authorization failures still throw.
- **Transaction queries**: wrap `where` clauses in `excludeInternalTransfers` / `excludeFromBudgetTotals` (and the `*OnSplit` variants) from `lib/domain/transaction-filters.ts`. `categoryId: null` means uncategorized *or* split - add `splits: { none: {} }` where it matters. Beware SQL three-valued logic: a bare `NOT` on a nullable column excludes NULLs too.
- **Money**: integer cents as `BigInt`, `Decimal.js` arithmetic, `lib/utils/format.ts` helpers. Never pass `BigInt` across the RSC boundary. Imported/manual dates are stored at noon UTC (`${date}T12:00:00.000Z`).
- **Dates in client components**: `formatDateShort(date, localeToIntl(useLocale()))`, never a bare `toLocaleDateString()` (hydration mismatch).
- **Revalidation**: mutating actions must revalidate something; use the helpers in `lib/actions/revalidate.ts` (surface map in `lib/domain/revalidation-surfaces.ts`, pinned by its test).
- **Middleware (`proxy.ts`, selfhosted-specific)**: auth exemptions live in the tested `isAuthGated`; anchor every alternative (`(?:\/.*)?$`) or a prefix like `/icon-512999` bypasses auth. Detect auth denials by response shape (`isAuthDenial`), never `instanceof NextResponse` - next-auth bundles its own copy, and that bug made every page public in v2.10.6-v2.11.0. `script-src` uses a per-request nonce.
- **Encryption at rest**: credentials and bearer tokens are AES-256-GCM `enc:v1:` values, written identically by `lib/domain/crypto-at-rest.ts` and `sync/crypto_at_rest.py` (byte-compatible - change both and their cross-language tests together). Tokens are looked up via a `tokenHash` column. Key: `ENCRYPTION_KEY`, else HKDF of `NEXTAUTH_SECRET`.
- **Sync service** (`dev-docs/sync-service.md`): an `Institution` has at most one per-user provider (Woob or Trade Republic credentials). `Account.syncId` is globally unique and its string shape (`woob:<inst>:<id>`, `tr:<inst>:<suffix>`, legacy `lcl:`/`tr:cash`) is owned by `lib/domain/sync-ids.ts` / `sync/db.py` - never match TR ids by prefix. `sync/db.py` writes `userId` explicitly from the institution's owner. App->sync is `SYNC_SERVICE_URL` (Docker-network only); sync->app calls (`/api/alerts/check`, `/api/transactions/auto-categorize`, `/api/investments/snapshot-balances`, `/api/realtime/notify`) authenticate with `Bearer $NEXTAUTH_SECRET`.
- **Verification habit**: a check that reports "clean" or a number must first be made to fail on purpose (break the property, assert a patch applied, compare against a known-bad input). Assert on structure, not on UI strings - `NextIntlClientProvider` inlines the whole messages JSON, so every label "appears" in every page's HTML; read the hydrated DOM.

### Net worth calculation

**Gross = fiat balances + holdings market value + real estate/automobile manualValueCents**
**Net = Gross − liabilityCents − loan remaining capital − latent taxes**

Latent tax rate: per-account via `getAccountTaxRate()` - see `dev-docs/investments-and-tax.md`. `UserSettings`'s PEA/CTO/Crypto rates (Settings → Fiscalité) are only the defaults suggested when creating a new account.

### Prisma client

This project uses **Prisma 7** with the `@prisma/adapter-pg` driver adapter (not the legacy built-in engine). `lib/db/prisma.ts` creates the client via a `pg.Pool` → `PrismaPg` adapter. Always import `prisma` from `@/lib/db/prisma` - never instantiate `PrismaClient` directly. The client is a module-level singleton (cached on `globalThis` in dev to survive HMR).

The client is generated to `app/generated/prisma` (gitignored, never committed). `pnpm install` runs it automatically via the `postinstall` script; re-run `pnpm exec prisma generate` manually after editing `schema.prisma` without reinstalling. In `Dockerfile`, the `deps` and `runner` stages run `pnpm install --frozen-lockfile` with `--ignore-scripts` because `prisma/schema.prisma` isn't copied into those stages yet - the `builder` stage generates the client explicitly once the full source is present.

### Server vs Client boundary

- All Prisma queries and third-party API calls **must** live in Server Components or Server Actions.
- Chart and interactive UI components are `"use client"`. Pass pre-fetched data as props.

### Amounts & precision

All monetary values stored as **integer cents** (`BigInt`). Arithmetic via `Decimal.js`. Use helpers from `lib/utils/format.ts` for conversion and display (do not inline formatting logic). Institution logos are fetched at runtime via Google Favicons using domain mappings in `lib/domain/institutions.ts` - add new institutions there, not inline.

## Design tokens

Defined in `globals.css`. Never use raw Tailwind colour classes for brand colours. Values below are the dark palette (the bare `:root` default) - see "Light theme" in `dev-docs/platform.md` for the `[data-theme="light"]` override values and why most, but not all, of these tokens have a light-mode counterpart.

| Token | Value | Use |
|---|---|---|
| `--accent` | #6366f1 | Active nav, primary highlight |
| `--positive` | #22c55e | Positive deltas |
| `--negative` | #ef4444 | Negative deltas, liabilities |
| `--surface` | #13131a | Card backgrounds |
| `--surface-elevated` | #1a1a24 | Hover states |
| `--border` | #2a2a38 | Dividers |
| `--muted` | #a1a1aa | Secondary text |

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## dev-docs/ index

Selfhosted-only, excluded from `sync-from-upstream.sh`.

| File | Covers |
|---|---|
| `dev-docs/testing.md` | Vitest scope, rendering-test spike, accepted coverage gaps |
| `dev-docs/dependencies.md` | pnpm overrides table, audit scope, `allowBuilds` |
| `dev-docs/release-audit.md` | Full pre-commit pipeline and release-boundary audit with every per-version result |
| `dev-docs/data-model.md` | Every Prisma model and its non-obvious columns |
| `dev-docs/multi-user-and-security.md` | Multi-user model, sharing, security audits, encryption at rest, hardening, auth/2FA, app-lock, share links, headers, REST API |
| `dev-docs/sync-service.md` | Sync modules, Woob setup/2FA/captcha, error classification, bank audit, per-user Trade Republic, real-time listeners, sync cadence |
| `dev-docs/alerts.md` | Alert channels (ntfy/email/Web Push), self-hosted ntfy/mail services, built-in triggers, custom alert rules |
| `dev-docs/transactions-and-budgets.md` | CSV import, recurring, manual entries, ledger, rollover, splits, auto-categorization, internal transfers, income |
| `dev-docs/investments-and-tax.md` | Tax treatment & country presets, realized gains, benchmarks, sector exposure, rebalancing, multi-currency, goals, projection, history charts |
| `dev-docs/platform.md` | PWA/service worker, i18n, light theme, demo mode, GoCardless, revalidation, backup/restore, container hardening, CI gates, migrations |
