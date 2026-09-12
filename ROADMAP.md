# Roadmap - Finalibaba Self-Hosted

Current release: **v2.10.4**

[SemVer](https://semver.org): `vX.Y` adds features, `vX.Y.Z` fixes. v2.0 was the one breaking change (multi-user).

**What goes where.** This file is the *what* and *when*, one line per item. The *why* - the reasoning, the measurements, the traps worth not falling into twice - lives in `CLAUDE.md`, next to the code it constrains. Anything finer than that is in `git log`.

Before tagging a `vX.Y`, run the release-boundary health audit in `CLAUDE.md`.

---

## Next

Demand-driven, not scheduled. Each needs a real user asking, or a materially bigger integration than anything shipped so far.

- **Interactive Brokers** - no Woob module exists; would need a direct integration.
- **GoCardless webhooks** - the findable webhook docs cover their Payments product, not Bank Account Data.
- **Plaid** - US/Canada coverage, where this app has no users yet.
- **Study what the four deferred cleanups would actually buy.** Each was skipped for a stated reason, and the reasons are worth re-testing rather than inheriting: mocking Prisma across `lib/actions/*` (23 files) to lift coverage, splitting `settings/page.tsx` (CCN 41) and `alert-rules-section.tsx` (CCN 26), driving the lizard warning count down, and testing the thin wrappers. The common objection is that each optimises a metric rather than the code, and two of them need a component-rendering harness this repo does not have. What is missing is a measurement of the other side: what maintainability, speed or clarity would genuinely improve if they were all done.

---

## v2.10.4 - Auditing the audit, and the complexity behind the line counts

- **A salary is a recurring transaction even though it is never the same amount.** The amount test rejected every varying series: a salary at 67% of a 70% threshold, a family benefit at 57%. Relaxed for credits only - measured first, because relaxing it for everything added four series and all four were shopping habits, not commitments. On a real account: 3 added, all genuine income, 0 noise. The monthly cadence band also widened to 26-35 days, recovering a 100,00 EUR standing order rejected on a 34-day median gap.

- **Five blind spots in the release audit**, found by asking each of its seven points the question that exposed the `sync/` one. It greps one direction of the layering rule, counts lines rather than complexity, measures JS coverage only, audits npm dependencies only, and triages two scanners out of eight - most of the rest running `continue-on-error`, so a green job proves nothing was blocked rather than nothing found.
- **`computeAnalytics` 68 -> 44 and `computeDashboard` 60 -> 34**, the two most complex functions in the repo, both deciding what net worth says. Guarded by a characterization test that pins their entire output to the cent; it never moved.
- **The second layering inversion**, in `lib/domain/accounts-page.ts`. `export-accounts-button.tsx` 488 -> 250.
- **From 0% to covered**: the two markdown builders (97% and 80%) and the pure half of the alert machinery, 55 new tests on code that had never had one. Two of those functions had each been fixed twice in production.
- **A path-scoped Sonar suppression does not follow the code it excuses** - 0 issues became 56 without a line changing, because two exemptions are keyed by file path. Back to 0, A/A/A, 0 hotspots.

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
