# Testing & coverage notes

Moved from CLAUDE.md. Commands are summarised there; this file keeps the detail.

## Development commands

This project uses **pnpm** (not npm/yarn) - the exact version is pinned in `package.json`'s `packageManager` field, and `corepack enable` (already run in the Dockerfile, and standard in Node 22+ environments) makes `pnpm` resolve to that exact version automatically.

```bash
pnpm dev         # Dev server (http://localhost:3000)
NODE_ENV=production pnpm run build    # Prod build + type-check (NODE_ENV=production REQUIRED)
pnpm run lint    # ESLint
pnpm test        # Vitest - see __tests__/
pnpm test __tests__/alerts.test.ts     # Single test file
pnpm test -- -t "name substring"       # Filter by test name across the suite
pnpm run test:coverage  # Vitest with coverage - see "Development commands" note below on the report
```

Docker (local dev - DB only, credentials fixed in `docker-compose.dev.yml`):
```bash
docker compose -f docker-compose.dev.yml up -d
# DATABASE_URL=postgresql://appuser:devpassword@localhost:5432/finalibaba
pnpm exec prisma migrate deploy   # first time only - applies schema to the fresh DB
pnpm run db:seed:demo             # optional - fills it with realistic fictional data to develop against
```

Production (one-shot setup):
```bash
cp .env.example .env   # fill in values
docker compose up -d   # builds and starts everything
```

Prisma:
```bash
pnpm run db:migrate -- --name <name>   # Create + apply migration
pnpm exec prisma generate               # Regenerate client after schema changes (also runs automatically via postinstall on `pnpm install`)
pnpm run db:seed                        # Seed common institutions (reference data, no accounts)
pnpm run db:seed:demo                   # WIPES all data, then seeds realistic fictional accounts/balances/holdings/transactions - for local dev/debugging
pnpm run db:push                        # Sync schema to DB without a migration (dev only)
pnpm run db:studio                      # Open Prisma Studio for DB inspection
```

npm-era scripts for Docker, kept for muscle memory - prefer the direct commands above, these are misleadingly named:
```bash
pnpm run docker:dev        # docker compose up -d       (despite the name, this runs the default/production docker-compose.yml)
pnpm run docker:dev:stop   # docker compose down
pnpm run docker:prod       # BROKEN - references docker-compose.prod.yml, which does not exist in this repo
pnpm run docker:prod:stop  # BROKEN - same reason
```

Vitest for unit tests - `pnpm test` runs everything under `__tests__/**`, covering `lib/domain/`, `lib/utils/`, `lib/services/` (all pure functions: money math, tax, loans, recurring-transaction detection, CSV import, analytics/dashboard aggregation, export completeness) and `lib/auth.ts` (rate limiter + the real `authorize()` credentials/bcrypt flow - see the comment on `provider.options.authorize` in `__tests__/auth.test.ts` for a real next-auth v4 footgun: `CredentialsProvider()`'s top-level `.authorize` is a hardcoded `() => null` stub, the real function only lives at `.options.authorize` until NextAuth's own request pipeline merges it). `pnpm run test:coverage` runs the same suite with a `text`+`json-summary` report - trust the JSON output over the terminal table, which has a rendering bug in this vitest version that silently drops some 100%-covered files from the printed table (their numbers are still folded into the overall summary).

**Known, accepted coverage gaps**: `lib/actions/*` (23 Server Action files - every DB mutation in the app) and `lib/services/gocardless.ts` are excluded from the SonarQube coverage gate wholesale (`sonar-project.properties`'s `sonar.coverage.exclusions`) even though four files now have partial Vitest coverage via the same mocked-`@/lib/db/prisma` pattern - `__tests__/totp-actions.test.ts` exercises `lib/actions/totp.ts`'s error paths and success data shape (not `startTotpSetup`'s QR generation), `__tests__/transaction-splits-actions.test.ts` exercises `lib/actions/transaction-splits.ts`'s sum-validation error path, sign-inference per line, and the delete-then-recreate write shape (added during v1.13's release-boundary audit specifically because this file enforces the "categoryId null iff split" invariant "Split transactions" above depends on - the exact "just became load-bearing" case that audit step calls out), `__tests__/goals-actions.test.ts` exercises `lib/actions/goals.ts`'s `assertGoalAccountEligible` guard (added during the pre-v1.14-release code review that found it missing - a goal linked to a LOAN account via a direct/manipulated Server Action call, bypassing the Settings picker's own exclusion, would silently show 0% progress forever with no explanation, since `assetRows` deliberately excludes LOAN accounts), and `__tests__/institutions-actions.test.ts` exercises `lib/actions/institutions.ts`'s `createInstitution`/`clearGocardlessConnection`/`getMigrationHistoryDepth`/`migrateDedicatedSyncToWoob` error paths and data shapes (added during the v1.15 release-boundary audit - this is the exact file the real LCL/Woob duplicate-account incident and its history-depth-loss follow-up lived in, see "Migrating an existing dedicated integration to Woob" above, the concrete "just became load-bearing" case the audit step below now cites). All four stay "light coverage only" per their own file comments, and the other 19 action files remain untested - a real test DB or broader Prisma mocking convention would still be needed to close the gap for good. `sync/` only tests the pure functions extracted from `sync_tr.py` - `sync_lcl.py`/`sync_woob.py`/`db.py`/`main.py`/`setup_lcl.py`/`setup_tr.py`/`setup_woob.py` are untested. **Component-rendering tests exist since v2.10.5, opt-in per file.** The sentence that used to stand here - no RTL, no committed harness - had become the stated reason for declining several refactors, so it was measured rather than inherited. `vitest.config.ts` keeps `environment: "node"` as the default and a rendering test opts in with `// @vitest-environment happy-dom` on its own first line, so the 66 pure-function files pay nothing. Three devDependencies (`@testing-library/react`, `@testing-library/dom`, `happy-dom`), about 18 MB, none of them shipped - the Docker `runner` stage installs `--prod`.

**What the spike settled, and it is the only thing that mattered**: it works on the component the refactor was declined for. `alert-rules-section.tsx` (810 lines, CCN 26) renders with three mocks - next-intl, next/navigation, the Server Action module - and a deliberate prop-wiring mistake, reading `rule.holding?.name` where `rule.account?.name` belongs, fails 2 of its 3 tests. That is exactly the class of bug the deferral was written about, so the deferral's reasoning no longer holds and the split is now a normal piece of work rather than a gamble.

**One trap, found the hard way and worth copying into any new rendering test**: mock `useTranslations` so it ECHOES its interpolation values, never as `(key) => key`. Every figure a data-wiring test needs - an account name, a threshold - travels in those vars, and the bare-key mock throws them away, leaving the assertion looking at an empty string while reporting an ordinary failure. The same shape as every other finding this version.

Cost per rendering file is roughly 20 seconds of environment setup against milliseconds of actual assertions, so these stay worth writing for wiring that cannot be checked any other way, not as a default. No Playwright as a committed dependency - components stay thin wrappers around the tested `lib/` functions by design, e.g. the dashboard's JSX extraction into `components/dashboard/dashboard-view.tsx` described under "Read-only share links" below.
