# Roadmap - Finalibaba Self-Hosted

Current release: **v2.12.3**

[SemVer](https://semver.org): `vX.Y` adds features, `vX.Y.Z` fixes. v2.0 was the one breaking change (multi-user).

**What goes where.** This file is the *what* and *when*, one line per item. The *why* - the reasoning, the measurements, the traps worth not falling into twice - lives in `CLAUDE.md`, next to the code it constrains. Anything finer than that is in `git log`.

Before tagging a `vX.Y`, run the release-boundary health audit in `CLAUDE.md`.

---

## Next

Demand-driven, not scheduled. Each needs a real user asking, or a materially bigger integration than anything shipped so far.

*Blocking reasons re-verified 2026-09-12 against live sources rather than carried forward: all three still hold.*

- **Interactive Brokers** - no Woob module exists; would need a direct integration. Re-checked against the live catalogue: 294 modules, 96 of them `CapBank`, no match for interactive/ibkr. Degiro and N26 do have one and are already reachable through the existing picker.
- **GoCardless webhooks** - the findable webhook docs cover their Payments product, not Bank Account Data. Re-checked against the current endpoint reference: five families (auth, institutions, agreements, requisitions, accounts), every one a synchronous REST call, no webhook or subscription anywhere.
- **Plaid** - US/Canada coverage, where this app has no users yet. The condition here is demand rather than feasibility, so it was checked as such: zero issues in the repository's entire history mention Plaid, Interactive Brokers or Revolut. Three issues exist in total, all about sync failures.
- **End-to-end encryption of bank credentials, per user.** The only design under which the instance operator genuinely cannot read them: a key derived from the user's own password, held in their session. The cost is that their bank only syncs while they are logged in - no 4h cron, no overnight alerts for them - so it is a per-user choice rather than a setting, and a real piece of work. Worth revisiting only if somebody actually asks for it.
- **`scripts/` is not linted, and CI now executes code from it.** `ci.yml` runs `ruff check sync/` only, so `scripts/lizard-blind-spots.py` - which `quality.yml` runs on every push - is unlinted. Extending it means fixing two pre-existing findings in `audit-bank-modules.py` first (ISC004, BLE001), both cosmetic.
- **`/invite/<bogus>` and `/shared/<bogus>` answer 200, not 404.** The right page renders (uniform not-found, no signal about which reason), so this is a status-code correctness point rather than a user-visible one, and both routes are already `robots: noindex`.
- **Convert the remaining Server Actions to `ActionResult`.** v2.12 converted the Security tab's session controls and the password form and documented the pattern in `components/settings/session-controls.tsx`; about sixty sites in `lib/actions/*` still throw, which production turns into an opaque digest. Convert per domain as each is touched, most-used forms first.
- **Give every Settings section an `id`.** The v2.12 tab check asserts on section ids rather than translated headings, and only the sections v2.12 moved or edited carry one - the Sharing and Notifications tabs have none, so their isolation is checked by panel, not per section.
- **`braces` GHSA-vfj7-8cjw-p6xm** names 3.0.4 as the fix, which has never been published (3.0.3 is the latest). Lint-time only and outside the `--prod` gate; add the override the day 3.0.4 exists.
- **Study what the remaining deferred cleanups would actually buy.** Each was skipped for a stated reason, and the reasons are worth re-testing rather than inheriting: mocking Prisma across `lib/actions/*` (23 files) to lift coverage, driving the lizard warning count down, and testing the thin wrappers. The common objection is that each optimises a metric rather than the code. What is missing is a measurement of the other side: what maintainability, speed or clarity would genuinely improve if they were done. (The harness objection that covered two more of these was measured in v2.10.5 and did not survive.)

---

## v2.12.3 - The sync badge only shows while a sync runs

- **The "sync in progress" badge appeared far too often and stayed until a refresh** (reported from a real instance). Four causes: it never cleared on navigation (it lives in the root layout and its cleanup left `syncing` true); every page change started a sync; staleness counted only successful syncs, so a bank stuck failing restarted a sync on every page; and it guessed a sync's end from SyncLog rows, which a sync that writes none never produces.
- **The sync service now tracks what runs** (`sync/sync_activity.py`, applied to every sync job) and exposes `GET /sync/running`. The badge shows exactly that, scoped to the viewer's own institutions, and disappears when it ends. `/sync/all/async` no longer stacks a second full sync behind a running one; a new `/sync/institution/{id}/async` keeps the page-load trigger from holding a Server Action for a whole bank sync.
- At most one auto-sync per page load and per 10 minutes per tab, measured from the last attempt. The badge is smaller, translucent, and never takes a tap.
- A member's own Trade Republic institutions now auto-sync too - only their Woob ones did.

---

## v2.12.2 - Transactions that fit, at every width

- **On an account page the transactions table scrolled sideways even on a large desktop**, hiding the income button; on a phone it was still a table. All three transaction lists (an account, `/transactions`, a budget category) share one `TransactionList`: a card per transaction below xl - label and amount first, date and account under them, then the controls - and a grid of fixed shared columns from xl. Nothing scrolls sideways at any width. One DOM rather than a table plus a hidden card list, since the category cell is interactive and would otherwise exist twice.
- **Settings on a phone**: a 3x2 grid of tiles with short names instead of a row that scrolled sideways with nothing saying more tabs existed. The side menu only from lg; at md it left so little room that the page scrolled sideways.
- **The "sync in progress" badge showed for two minutes when no sync ran**: `autoTriggerSync` answered "triggered" even when the request to the sync service failed, and the client only recognised the `.env` Trade Republic source finishing. It no longer takes taps meant for what is under it either.
- Overflows at 768px (Analytics KPI cards, account tabs, dashboard row) and a clipped account header and import button on narrow phones.
- **The visual audit measures what it missed**: content hidden in a scroller at 1024px+, `<main>` scrolling sideways (naming the element responsible), text spilling out of its box, content clipped by an ancestor, and controls under a fixed element. All at 0 after these changes, and confirmed to fire on the version before them.
- The new list's first CI run failed the lizard blind-spot ratchet: its header type used the `Readonly<{...}>` alias this repository documents as blinding lizard. Fixed rather than re-baselined.

---

## v2.12.1 - v2.12.0 never deployed, and the screens it missed

- **v2.12.0 published its images but never deployed.** Trivy failed the app image on undici 6.28.0 (CVE-2026-19534), bundled inside the pnpm that corepack caches in the image rather than in this project's tree - the same shape as the earlier `tar` incidents - so `notify-deploy` was skipped. pnpm 11.28.2 bundles 6.28.1. The same scan found `/app/.pnpm-store` in the image: with the store on a cache mount pnpm cannot hard-link across filesystems and quietly makes a second one inside the project, and the `rm -rf` the Dockerfile comment promised did not exist.
- **A visual audit of every page** (`scripts/ui-audit/run.sh`): six widths from 360px to 2560px, both themes, axe-core plus overflow, touch-target and console checks, and screenshots. 186 WCAG 2.1 AA violations down to 0, 725 undersized phone targets down to 92.
- **On a phone, the amount was off-screen on every transaction row.** It now follows the label in both transaction tables; the account folds under the label.
- Contrast: dimmed secondary text and text on the red/green tints fell as low as 2.89:1. New `--negative-text` / `--positive-text` tokens, measured with the WCAG formula.
- Every `<Button>` is at least 44px wide; scrollable tables are reachable from the keyboard; the Settings tab row now actually stays at the top on phones and opens on the active tab.
- **The public demo's net worth chart ended at ~23k under a 230k figure**: the seed wrote loans as negative balances and the history subtracted them again, and investments had no history. Its transactions could also be dated in the future.
- `python-jose` CVE-2026-85394 (no fix released) is ignored in both workflows with its reasoning: the only consumer reads tokens with `get_unverified_claims()` and never verifies one. `urllib3` raised to 2.8.0 in the sync image.

---

## v2.12.0 - Settings in tabs, and nobody is the owner by default

- **Settings is six tabs instead of one 22-section column**: Accounts & sync, Financial profile, Security, Sharing & access, Notifications, Display. Each tab is its own Server Component that loads only what it shows, so opening Display no longer pays for every institution's sync status, the audit log and the alert-rule pickers. Selected by `?tab=`, so a tab is linkable and the back button works; tabs with nothing to show in a mode (demo) are left out.
- **An anonymous request is no longer the instance owner.** With `AUTH_ENABLED=true`, `getViewer()` used to resolve "no session" to the owner with role ADMIN - meant for the public routes' layout, but a Server Action is invocable from any page, those included. It now refuses; only the root layout may ask for a nullable viewer (`getPublicViewer`), and it renders a bare page for nobody.
- **Paths ending in an image extension were exempt from the session gate**, and dynamic routes accept dots, so `/accounts/x.png` rendered with no session. No real file needed the exemption (`public/` holds none); the exemptions now name the real files.
- **The login rate limit could be bypassed** by writing a new `X-Forwarded-For` on every attempt: it read the first entry, which the client controls, even behind a proxy that appends the real one. It now counts trusted proxies from the right (`TRUSTED_PROXY_COUNT`) and trusts no forwarding header by default.
- **A database restore checks its `Origin`.** It is a Route Handler, so it had none of the protection Server Actions get, and on a default instance (no auth) any page on any site could submit a form to it. Strict against `APP_URL` when set, against the request's own host otherwise.
- **The backup passphrase left the URL.** The download was `GET /api/backup?passphrase=...`, written into browser history and every proxy log; it is now a form `POST` to `/api/backup/download`. A request without a passphrase also no longer starts a full `pg_dump` before being refused.
- **Failures in Settings say so.** "Sign out everywhere" threw into a form nobody read, so a failure looked exactly like success on the control used when a device is stolen. Expected failures are now returned (`ActionResult`), shown beside the control, and anything thrown arrives as a readable "unexpected" message rather than a digest - the pattern to copy, documented in `session-controls.tsx`.
- **`computeAnalytics` 44 -> 4 and `buildMarkdown` 52 -> 1** cyclomatic complexity, split into named pure steps. Characterization snapshots were added first, generated against the old code, and the refactor was held to them byte for byte.
- **17 dependency advisories closed** and the open Dependabot PRs folded in: Next 16.3.8 (critical `next/og` advisory), nodemailer 10, React 19.3, `fast-uri`, `js-yaml`, `brace-expansion`, and the Python floors (`cryptography` 50, `playwright`, `python-jose`...).
- Two tests were failing on `main`: one hardcoded the current month and broke on 1 October, the other assumed Node <25's storage globals.

---

## v2.11.3 - The sync image v2.11.2 never built

- **v2.11.2 published no sync image**, which is the one artefact its fix lived in. `docker.yml` runs its own `pip-audit`, separate from `ci.yml`'s, and only the latter had been given the documented `ecdsa` exemption - so the release workflow failed on the audit, the sync image was never pushed, and `notify-deploy` was skipped. Nothing deployed half-way; the instance simply never heard about it.
- The ignore is now stated in both workflows, with a note in each saying the other exists. Two copies of a check need two copies of its exemption, and finding that out from a failed release is the expensive way.

---

## v2.11.2 - A bank that cannot load says so, instead of answering 500

- **Caisse d'Epargne and Banque Populaire can be connected.** Their Woob modules need two Python packages the image did not ship (`python-jose`, `chompjs`), so the module never loaded. Measured across the 18 largest French banks in the catalogue rather than added one report at a time: exactly those two packages were missing, and only those two banks needed them. Adding only `python-jose` - the one the log happened to name first - would have moved the same failure along to `chompjs`.
- **A guard that was never a guard.** Both the setup and the sync paths wrapped `w.load_backends(...)` in `try/except`, and `load_backends` does not raise: Woob logs a module it cannot load and carries on. So the except never fired, and the next line died on a `KeyError` the user received as a bare 500, four times in a row, with nothing on screen saying why.
- The module is now loaded explicitly first, because that is the call carrying the real cause, and the registration is checked rather than assumed. The message names the missing package, so the next bank to hit this is self-diagnosing.
- **The sync path stopped blaming the credentials.** It reported "No accounts returned - check credentials or run interactive setup" for a failure that had nothing to do with credentials. It now writes `unsupported`, which alerts once instead of nagging every 24h about something only a new image can change.
- `woob[lcl,swile]` in `requirements.txt` installs nothing: woob 3.7 publishes no extras at all. Left in place as a statement of intent, documented as not being a mechanism.
- **One accepted vulnerability, with its reasoning written down**: `python-jose` requires `ecdsa`, which has an unfixed Minerva timing attack on P-256 signing and no planned fix. Verification is unaffected, these modules consume tokens the bank issues rather than signing with their own key, and `sync/`'s API is Docker-network-only. Ignored explicitly in CI with that argument beside it, not silenced.

---

## v2.11.1 - Every authenticated page was public

- **Update immediately if `AUTH_ENABLED=true`.** From v2.10.6 to v2.11.0, a request carrying no session at all rendered `/`, `/settings`, `/accounts`, `/transactions`, `/analytics`, `/budgets`, `/income` and `/recurring` with the instance owner's data, admin-only Settings included. No login, no cookie, no link to guess.
- **`instanceof` across a module boundary.** v2.10.6 routed the auth decision through a wrapper so the CSP nonce could be attached to permitted requests, and asked `authResult instanceof NextResponse` to tell a refusal from a permission. next-auth bundles its own copy of `next/server`, so the `NextResponse` it builds is a different class object: the check answered false for a real `307` to `/login`, the code fell through to `NextResponse.next()`, and the refusal became an authorisation.
- **`getViewer()`'s owner fallback is what turned that into a data leak.** It is reachable exactly when there is no session, which is the case it was written for - `/login` and `/invite` still have to render something. With the gate open, "no session" stopped meaning "anonymous visitor" and started meaning "the owner".
- The decision is duck-typed now (`isAuthDenial`), so a second copy of a module cannot defeat it, and the test builds its refusal from a deliberately foreign class - one using the real `NextResponse` would have passed against the broken code.

---

## v2.11 - Each person's own data, each person's own file

- **Every user can export their own data**, which an invited one previously could not do at all: the whole Backup area was admin-gated, so a member had no button and no route. Settings -> "Mes données" gives anybody a JSON file of their accounts, balances, transactions, holdings, categories, budgets and goals. Scoped by `Account.userId` rather than by what the caller may read, so a co-owned account stays with whoever created it instead of landing in both people's files.
- **The admin no longer has to take everyone's data to get their own.** Asked directly: "je veux pas pouvoir exporter et voir le compte de mes potes, chacun sa sauvegarde non ?". Both halves were true, and the per-user export is the answer to the second.
- **No credential ever reaches the file.** v2.10.6 encrypted the bank logins, the TOTP secret, the SMTP password and the three bearer tokens; writing them back out in clear, into a file destined for a Downloads folder, would undo that in one feature. An institution exports its name and module, never its login. `Account.syncId` stays behind too - it is globally unique and names a connection on one instance.
- **The whole-database dump now requires a passphrase.** It was optional while an instance had one user, where the only record in the file was the downloader's own. It is still the way to restore an instance, and still admin-only.
- **`scripts/backup.sh` is safe to put on a cron**: `--keep N` retires old dumps, `--quiet` keeps a nightly job silent until it has something to say, and an empty dump is reported as a failure rather than a success.
- **The export's completeness is pinned against `schema.prisma` itself**, so a column added to `Account` and forgotten fails a test rather than surfacing on the day somebody restores. It earned that immediately, catching a column this file documented and the database did not have.
- **Not yet: reading an export back.** The file is complete and faithful, nothing restores from it. Restoring an instance still goes through the full dump.

---

## v2.10.7 - The first bug a test user found

- **A member signing in inherited the owner's lock screen.** Reported from a real instance within a day of v2.10.6: create a test user, sign in from a private window, get asked for the app lock, refresh and it is gone. `AppLockGate` lives in the root layout so it survives the navigation a login performs, and its state came from `useState(!enabled)` - evaluated at mount, on `/login`, where there is no session and `getViewer()` resolves to the instance owner by design. The owner's setting locked a member who has none, and only a reload cleared it. The flag is read on every render now, and the layout no longer produces it at all on a route where nobody is signed in.
- **The SonarQube gate is green**, 0 violations from 8. One was a genuinely dead `import {}` with no specifiers, left by the v2.10.2 split. One was the 2FA checkbox having no accessible name, its title buried three elements inside the label.
- **Most of the coverage failure was a report that was never generated.** New-code coverage read 72.5% against a threshold of 80, and `sync/workers.py` - at 100% locally - was recorded as 0.0%, because `sync/coverage.xml` did not exist when the scan ran. Generating it takes the figure to 81.0% with no test written for it. The trap is documented in `.coveragerc` and had already cost the v2.1 gate.
- **Session revocation is tested on its own**, extracted from `getViewer` while reducing its complexity. It is the whole security property of "sign out everywhere" and was previously reachable only by standing up a real session.

---

## v2.10.6 - Credentials stop being readable, and actions start being recorded

- **Credentials are encrypted at rest.** `SELECT "woobLogin", "woobPassword" FROM "Institution"` used to return every invited user's bank credentials in clear text. Now AES-256-GCM, mirrored between the app and the Python sidecar and tested from both directions - a format mismatch fails at 4am against a real bank, not at build time. Also the 2FA secret, the SMTP password, the ntfy token and the three bearer tokens. **The post-v2.0 audit had listed this and accepted it**, on a threat model written when the app was single-user; multi-user changed what that sentence meant and nobody re-derived it.
- **Not the financial data, and that is a decision rather than an omission.** The app sums and groups balances in SQL and computes net worth at 4am with nobody logged in. Encrypting them ends both. The key also lives on the server, because unattended sync needs it to - so this protects a leaked dump, not the person running the instance.
- **The backup file can be passphrase-encrypted**, which is where the financial data CAN be protected: it is the one artefact that leaves the machine.
- **Sessions can be ended without deleting the account.** Before, a stolen phone meant choosing between a live 30-day session and cascading someone's whole portfolio.
- **Attempt limits survive a restart**, cover invitation redemption, and fail open rather than locking everyone out.
- **An activity log**, because everything else prevented actions and nothing recorded them.
- **`script-src` uses a per-request nonce** rather than `'unsafe-inline'`, and `/shared` and `/invite` get a CSP for the first time - the auth matcher had been skipping them entirely.
- **An admin can require 2FA** for every user on the instance.
- The whole migration runs itself at startup: deploy, and it is done.

---

## v2.10.5 - The tests that were missing, and the gate that was not looking

- **A generic transfer label is never relaxed for a varying amount.** v2.10.4 relaxed the amount test for credits; the amount test was the only thing protecting "VIREMENT SEPA", which a bank reuses for a transfer between your own accounts and for unrelated credits alike. `lib/domain/transfer-labels.ts` holds the denylist, dependency-free because it now has consumers on both sides of what would otherwise be an import cycle.
- **Component-rendering tests, measured rather than argued about.** Three devDependencies, opt-in per file via `// @vitest-environment happy-dom`, so the 66 pure-function files pay nothing. The spike's only real question was whether it catches the class of bug the deferrals were written about: a deliberate prop-wiring mistake in `alert-rules-section.tsx` fails 2 of its 3 tests, so it does.
- **The two components those deferrals protected are now split.** `alert-rules-section.tsx` 810 -> 248, and `settings/page.tsx` 786 -> 539 with its institution row and tax form extracted. The row took every sync-status concern with it; neither had another consumer.
- **`isDemoMode()` replaces sixteen hand-written comparisons** of `process.env.DEMO_MODE`, thirteen in one file and in both directions. Each decides whether to render a section that mutates, reveals a stored credential or mints a token.
- **The complexity ratchet now also ratchets what lizard cannot see.** Its JS/TS reader drops functions silently, at exit code 0, and a dropped function leaves the count it gates on. 54 declared functions across 35 files, including `calcCurrentCapital` and `calcLoanStats`. Found by adding one accidentally: the warning count went down because a 41-CCN function had become invisible.

---

## v2.10.4 - Auditing the audit, and the complexity behind the line counts

- **A salary is a recurring transaction even though it is never the same amount.** The amount test rejected every varying series: a salary at 67% of a 70% threshold, a family benefit at 57%. Relaxed for credits only - measured first, because relaxing it for everything added four series and all four were shopping habits, not commitments. On a real account: 3 added, all genuine income, 0 noise. The monthly cadence band also widened to 26-35 days, recovering a 100,00 EUR standing order rejected on a 34-day median gap.

- **Five blind spots in the release audit**, found by asking each of its seven points the question that exposed the `sync/` one. It greps one direction of the layering rule, counts lines rather than complexity, measures JS coverage only, audits npm dependencies only, and triages two scanners out of eight - most of the rest running `continue-on-error`, so a green job proves nothing was blocked rather than nothing found.
- **`computeAnalytics` 68 -> 44 and `computeDashboard` 60 -> 34**, the two most complex functions in the repo, both deciding what net worth says. Guarded by a characterization test that pins their entire output to the cent; it never moved.
- **The second layering inversion**, in `lib/domain/accounts-page.ts`. `export-accounts-button.tsx` 488 -> 250.
- **From 0% to covered**: the two markdown builders (97% and 80%) and the pure half of the alert machinery, 55 new tests on code that had never had one. Two of those functions had each been fixed twice in production.
- **A path-scoped Sonar suppression does not follow the code it excuses** - 0 issues became 56 without a line changing, because two exemptions are keyed by file path. Back to 0, A/A/A, 0 hotspots.
- **The six scanners nobody had ever opened**, triaged for the first time. Five clean; semgrep held one finding sitting in a green job, and the fix it invited would have duplicated transactions on every install.
- **The alert checkers, from 0% to 72%**, aimed at wiring rather than arithmetic - the only real bug this file has ever had was a missing filter, and a missing filter does not fail, it includes too much in silence.
- **Measured why the 56 migrations must not be squashed**: keeping them costs about five seconds per container start, squashing them leaves every existing database in a failed-migration state needing manual recovery.

---

## v2.10.3 - The rest of the oversized files

- **Five oversized files split, by concern rather than to hit a number.** `app/api/alerts/check/route.ts` 846 -> 143, flagged by five audits, and none of it belonged in a route handler. `components/shared/export-analytics-button.tsx` 639 -> 186, which also fixed a layering inversion nothing had flagged: `lib/` was importing a payload type back out of `components/`. And the two nobody had ever measured, `sync/sync_tr.py` 1172 -> 896 and `sync/main.py` 919 -> 766.
- **The audit had a blind spot, and it cost five rounds.** Its file-size check only ever ran `wc -l` over `app/`, `components/` and `lib/`, so the largest file in the repository was never once measured. It now covers `sync/` too.
- Left alone deliberately: `components/settings/alert-rules-section.tsx` (810) and `app/settings/page.tsx` (786) are composition rather than complexity, and this repo has no component-rendering tests to catch a prop-wiring slip.

---

## v2.10.2 - A hand-marked transfer no longer strands its other leg

- **Marking one leg of a transfer by hand left the other counting as spending, for good.** A hand-marked row left the detection pool entirely, so the leg that should pair with it had no partner available and could never be flagged. Found on a real database where a transfer moves through three accounts: 1 100 EUR of Livret A debits still counted while their credits did not, understating a month's "reste à vivre". The pool now keeps hand-marked rows as partners, never as rows it may revoke.
- **`lib/domain/analytics.ts` split**, 1148 lines into 654 plus three siblings (market data, types, export payload). Flagged by four audits running. Text moved, nothing else: the fifteen call sites were untouched.

---

## v2.10.1 - Housekeeping

- `scripts/flag-internal-transfers.sh` - bulk-marks the transfers no matcher can find, because one leg predates the account's own history. 54 rows, ~24 285 EUR on a real instance.
- **This file and the code comments, cut back.** The roadmap was 592 lines in no consistent order; it is 127, newest first, with the *why* left in `CLAUDE.md` where it belongs. Comments went through the same rule - one earns its place if removing it lets someone reintroduce a bug - taking 3 626 lines of 8+ line blocks down to 2 900 across 109 files.
- **SonarQube at 0 issues and 0 hotspots**, A/A/A. Nine small real ones (a `FormData.get` that can return a File and stringify as `[object Object]`, two undocumented empty methods, a test mutating a module global, two composite assertions) plus one worth the refactor: `upsert_transaction` at cognitive complexity 30 against a limit of 15, now three functions for the three questions its dedup actually asks.
- **next 16.3.4, next-intl 4.14.3, lucide-react 1.44, tsx 4.23.13, and @simplewebauthn/server + /browser to 14.0** - the pair applied together, since each major alone fails type-check against the other still on 13.
- **No Dependabot PR could be merged at all**, and it was not the type error: the branch ruleset required a status check named `npm audit` while the job has been `pnpm audit` since the pnpm migration, so that context never reported. Fixed in the repo settings.

---

## v2.10.0 - The audit's own findings, patched

The end-of-version audit found twenty-five defects. v2.9.2-v2.9.4 fixed the ones losing data; this closes the rest. Verified against a copy of a real database throughout - three decisions below were made one way by reasoning and reversed by measurement.

**Budgets and transfers**

- Buying shares was counted as spending; 438 rows reclassified, September's "reste à vivre" went from -252,76 EUR to +126,31.
- Un-marking a transfer by hand did not survive the next sync. Three-state model (`internalTransferManual`).
- A wrong pairing was permanent. The pass re-derives its own pairings, and `internalTransferPairId` is what makes revoking one safe.
- The matcher lost legs: rewritten as an augmenting-path matching. On real data, 32 legs newly flagged, 35 re-paired, 1 revoked.
- A card payment no longer competes to be one leg of a transfer (`Transaction.sourceEventType`, the bank's own word for the movement). Not backfillable - applies to transactions synced from here on.
- Internal transfers stopped being offered as recurring subscriptions, and the bulk "mark as income" stopped recording them as dividends.

**The same figure on every screen**

- Three screens disagreed about what net worth is; it is after latent tax everywhere now, and the projection draws both curves.
- The net-worth history subtracted the original loan capital for every past day instead of amortising it.
- The projection never deducted the latent tax already owed on day one.
- The passive-income card linked out of someone else's portfolio into your own pages.

**Imports and manual entries**

- `1,234` imported as 1,23 EUR - the comma was only ever read as a decimal separator.
- An invalid date rolled forward silently: the 30th of February landed on 2 March.
- A manual entry on an account with no starting balance derived one from zero and showed it as fact.
- The balance importer trusted the browser for its date checks, and appended where it should have replaced.

**Positions, alerts, sync**

- Clearing a foreign-currency position's cost basis put the two halves of one figure on different rates, unreconcilable.
- "New transaction" alerts skipped every row past the cap, permanently - one sync batch shares one timestamp.
- The Woob sync truncated cents where the Trade Republic sync documents rounding; 500 shares at 134,5678 EUR recorded 67 280 instead of 67 283,90.
- A securities account that stops reporting keeps its positions and now records when it was last confirmed.

**Savings estimates**

- One rate for all 24 fortnights, for a rate that moves mid-year. `AccountInterestRate` records what an account paid *until* a date: 486,35 EUR on a real portfolio, against 503,45 at a flat 1.7% and 476,98 at a flat 1.5%.
- The suggested regulated rates were six weeks stale, and the generic-livret fallback was a second copy of the same literal.
- The rate field never said it wanted a net figure.
- A fresh install was offered the old 17.2%: the migration that moved the rate changed the data and never the column default. CI now replays the chain into an empty database.

**Recurring**

- A merchant can be a subscription and a shop at once, and detection only saw the average. A label that fails as a whole is re-examined for a consistent series inside it - finds a 6,99 EUR monthly Amazon charge, and a salary whose bonuses defeated the amount test.
- Savings-plan executions left the suggestion list (reversed on measurement: 11 of 26 suggestions were Sparplan lines).

**Tooling**

- `scripts/check-balance-reconciliation.sh` - stored transactions against the bank's own reported balance.
- `scripts/fix-restated-label-duplicates.sh` corrected twice, both found by running it rather than reading it.

---

## v2.9.x - Data the sync was losing

- **v2.9.4** - one movement described twice is not two movements: a restated LCL label stored as a second row, and Trade Republic emitting both a `Kauforder` and a `PEA` event for one purchase. Settled against the bank's own balance (-325,41 EUR real vs -3 470,52 stored). Plus `scripts/fix-restated-label-duplicates.sh`.
- **v2.9.3** - v2.9.2 prevented new collisions and could not undo the old ones; the recovery lookup was label-blind, so a survivor answered for its lost twin.
- **v2.9.2** - two transactions with the same date and amount became one; the ±3-day near-duplicate window ignored the label; each Settings card erased the other's data; the interest chart contradicted the figure above it.
- **v2.9.1** - the projection's "épargne" rate ignored the weighted savings rate v2.9.0 had just added.
- **v2.9.0** - a manual override for internal-transfer detection; the year-end interest estimate was understating real accounts; its own card and a chart of how it moved through the year.

## v2.8.0 - Real savings estimates, and why the numbers kept reverting

Every rebuild invalidated open tabs' ability to save (`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`), plus the same stale-value shape at three more layers. Balance-weighted livret rate, full-year projection by the *méthode des quinzaines*, `Account.dividendsAlreadyNet`, and period navigation on `/budgets` and `/income`.

## v2.4-v2.7 - Banks a human can actually connect

- **v2.7 / v2.7.1** - a captcha bank could connect and import nothing (four stacked defects); holdings read from the bank rather than just a balance; every login failure classified once (`sync/woob_errors.py`); `scripts/audit-bank-modules.py` with a monthly CI job. v2.7.1: the settings page showed yesterday's numbers, the French social-levies rate moved to 18.6%, and an LCL 502 no longer fails a whole sync.
- **v2.6 / v2.6.1** - a phone approval after the captcha was fatal; manual entries on an account nobody else writes to; `assertManualAccountEligible`.
- **v2.5 / v2.5.1** - a captcha is solved by the person, in Settings, rather than the bank being told to give up.
- **v2.4.x** - real-time tracking had never processed a single push (two independent causes, four releases apart); banks that cannot be synced say so; a share link showed the app-lock screen to a stranger; the fiscal model stops assuming France (`UserSettings.country`, `Account.interestRatePct`); `/settings` regrouped by subject; a dismissed recurring suggestion stopped adding a row to the list.

## v2.0-v2.3 - Multi-user

- **v2.3** - real-time for every connection, not just the env one; a feature broken by a migration it did not participate in.
- **v2.1 / v2.1.1** - per-user bank connections (`Institution.trPhone`/`trPin`), and `adoptDedicatedTrAccounts` to move off `TR_PHONE` without losing history.
- **v2.0** - multi-user: one always-present owner, `baseAccountIds` vs `viewAccountIds`, co-ownership and portfolio grants, followed by a dedicated security audit.

---

## v1.x

| Version | What it added |
|---|---|
| v1.17 | Trade Republic real-time tracking; 30-minute Woob sync; new-transaction alerts |
| v1.16 | Rebalancing-drift alerts; sector-exposure breakdown; historical allocation chart; on-demand FX revaluation |
| v1.15 | App-lock (WebAuthn); Web Push; "Auto" theme; full UI/UX audit |
| v1.14 | Multiple named savings goals; long-term net worth projection |
| v1.13 | Global transaction ledger; split transactions; budget rollover |
| v1.12 | Public REST API; PWA; light theme; richer share view |
| v1.11.x | Connect any Woob bank without a terminal; full catalog; duplicate-account cleanup |
| v1.10.x | Explicit income/expense categories; "reste à vivre"; accessibility and responsive pass |
| v1.9 | Internal transfer detection; clearer sync-failure notifications |
| v1.8 | "Mark as income" from a real transaction |
| v1.7 | Automatic categorization: self-learning, MCC, merchant dictionary |
| v1.6 | Custom alert rules |
| v1.5 | 2FA (TOTP); read-only share links; alerts and webhooks |
| v1.4 | Benchmarks; rebalancing; income tracking; per-account tax treatment; multi-currency |
| v1.3 | Categories and budgets; recurring transactions |
| v1.2 | CSV import; historical balance import; backup and restore |
| v1.1 | English/French UI; editable tax rates; auto-sync on open |
| v1.0 | `docker compose up`; every account type; live prices; Trade Republic, LCL and Woob sync; GoCardless PSD2; AGPL-3.0 |
