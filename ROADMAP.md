# Roadmap - Finalibaba Self-Hosted

Current stable release: **v2.1.0**

Versions follow [Semantic Versioning](https://semver.org). Minor versions (1.x) are additive and backwards-compatible. v2.0 is a breaking architectural change (multi-user).

Before starting a new version's work (or right before tagging one), run the release-boundary health audit in `CLAUDE.md` - layering, complexity hotspots, real test-coverage gaps, recurring-bug patterns, doc drift, dependency health, and open security alerts. v1.13 is the first version planned with this as a standing step, not a one-off.

---

## v1.1.0 - Released ✓

- [X] **English & French UI** - `next-intl` integration, language auto-detected from browser (`Accept-Language`), manual switcher in Settings. No URL prefix per locale.
- [X] **User-configurable tax rates** - PEA, CTO, and Crypto rates editable in Settings.
- [X] **Mobile UX improvements** - WCAG-compliant touch targets (44×44px), responsive header layouts, icon-only buttons on narrow viewports.
- [X] **Auto-sync on app open** - sync triggered automatically when opening the app (all sources: LCL, Trade Republic, Woob institutions). Badge shown during sync.

---

## v1.2 - Data import & resilience - Released ✓

*The most-requested gap vs alternatives: getting data in without auto-sync, and keeping it safe.*

- [X] **CSV import** - bulk import of transactions for accounts not covered by auto-sync
- [X] **Historical net worth import** - import past balance snapshots (CSV/spreadsheet) to backfill the historical chart for users migrating from Excel or Finary
- [X] **Backup & restore** - one-command database export and full restore; critical for self-hosters before upgrades

---

## v1.3 - Budgeting & cash-flow - Released ✓

*The main gap vs Firefly III: spending visibility and forward projection.*

- [X] **Transaction categories & budgets** - categorize transactions (food, transport, housing…), set monthly budget envelopes per category, track spending vs budget
- [X] **Recurring transactions** - flag subscriptions and regular income; project future cash flow and detect missed payments

---

## v1.4 - Advanced analytics & international fiscal support - Released ✓

*Power features for investors, and making the tax layer work correctly regardless of where you live.*

- [x] **Benchmark comparison** - overlay portfolio CAGR against a reference index (MSCI World, S&P 500, CAC 40)
- [x] **Portfolio rebalancing** - define a target allocation per account, show current drift, suggest trades to rebalance
- [X] **Interest & dividend income tracking** - record interest earned on savings accounts (taxable or exempt) and dividends received on investment accounts as discrete income events, separate from balance snapshots; display as income in analytics
- [X] **Flexible account tax treatment** - each investment account gets a user-defined tax status (tax-exempt like PEA/ISA/Roth IRA, tax-deferred like PER/401k, or fully taxable); latent tax calculation uses the account's own status instead of a global type - makes the app correct for non-French users who have no PEA equivalent
- [x] **Annual tax report** - yearly fiscal summary: realised gains, dividend income, taxable events; designed to be country-agnostic (exportable data) with a French IFU-ready view as a first implementation
- [x] **Multi-currency** - hold positions in USD, GBP, CHF and display everything converted to the reference currency (EUR)

---

## v1.5 - Security & sharing - Released ✓

*Hardening the built-in auth and enabling controlled access for advisors or family.*

- [X] **2FA (TOTP)** - two-factor authentication for the built-in credentials provider (`AUTH_ENABLED=true`)
- [X] **Read-only share link** - generate a token-protected view-only URL to share the dashboard with an advisor or spouse without giving write access
- [X] **Alerts & webhooks** - notify via ntfy or email when net worth crosses a threshold, a loan is nearly paid off, or a sync fails

---

## v1.6 - Custom alert rules - Released ✓

*Extends v1.5's alerts with user-defined conditions on top of the 3 fixed triggers, which stay non-editable in content.*

- [X] **Custom alert rules** - six rule kinds: account balance threshold, account overdraft, investment/crypto account value threshold, a specific holding's price threshold, unrealized gain (percentage or amount, one account or the whole portfolio), and per-category budget overruns (re-arms every calendar month); each rule supports an optional custom message, configurable in Settings

---

## v1.7 - Automatic transaction categorization - Released ✓

*The main remaining friction in budgeting: manually picking a category for every transaction.*

- [X] **Self-learning categorization** - learns a per-account `label -> category` mapping from the user's own categorization history, and applies it automatically to future transactions with the same label (min. 2 prior occurrences, 70% category consistency)
- [X] **Merchant Category Code (MCC) matching** - for GoCardless-synced accounts whose bank populates the PSD2 `merchantCategoryCode` field, maps the card network's own merchant classification to a default category
- [X] **Curated merchant dictionary** - ~180 well-known French/international brand patterns (supermarkets, restaurants, transport, streaming, telecom, gyms, insurance, shopping, leisure) mapped to 7 broad default categories, grouped by payment nature (e.g. gym memberships and streaming subscriptions both fall under "Abonnements") rather than by life domain
- [X] **GoCardless transaction sync** - `Transaction` rows (not just balances) are now synced from GoCardless-linked accounts, feeding both budgets and the MCC signal above
- [X] **"Auto-catégoriser" button** on `/budgets` for an on-demand backfill, plus automatic runs after every CSV import, GoCardless sync, and scheduled sync cycle

---

## v1.8 - "Mark as income" & categorization fixes - Released ✓

*Closes the gap between "a real dividend/interest transaction exists" and "it's recorded for the tax report" - and fixes two real production issues found using v1.7's automatic categorization.*

- [X] **Mark as income** - create an `IncomeEvent` directly from a real transaction row (amount/date pre-filled, linked back to it) instead of retyping everything by hand on `/income`; offers to apply to every other not-yet-recorded transaction with the same label in one click
- [X] **Dividend income allowed on checking accounts** - Trade Republic's combined cash account can legitimately receive a dividend payout, not just a dedicated investment account
- [X] **Fix: recurring-label categorization now ignores an embedded year** - "INTERETS 2025"/"INTERETS 26" (a once-a-year Livret interest credit) are recognized as the same label regardless of 2 vs 4-digit year formatting
- [X] **Fix: Trade Republic "Sparplan" (recurring investment purchase) false positive** - was being mis-categorized as a supermarket purchase (v1.7.1)

---

## v1.9 - Internal transfer detection & clearer alerts - Released ✓

*Fixes two more real production issues: a bank's generic transfer label mis-categorizing internal transfers as income, and unreadable sync-failure push notifications.*

- [X] **Internal transfer detection** - a transaction is now recognized as money moving between two of your own accounts by matching amount/date pairs across accounts, independent of the bank's label text; detected transfers are excluded from automatic categorization (never land in "Revenus" or any other category on their own) and from the budgets page's uncategorized-spend nagging - still categorizable by hand if you want to track them
- [X] **Fix: generic transfer labels no longer drive bulk categorization** - a bank's catch-all wording ("VIREMENT SEPA") is reused for both real internal transfers and real external payments with no way to tell them apart from text alone; self-learning and "apply to similar"/"mark similar as income" no longer treat this as a trustworthy group
- [X] **Clearer sync-failure notifications** - replaced a raw internal source id ("woob:cmqpvbok4...") with the actual institution name, and the sync script's own CLI-oriented error text ("lance --setup") with a plain, translated sentence

---

## v1.10 - Explicit income/expense categories - Released ✓

*Fixes a UX complaint found using v1.9's income tracking: an income category ("Revenus") permanently read as €0 spent on `/budgets`, since that page only ever summed debits.*

- [X] **Category type (Dépense/Revenu)**, chosen explicitly at creation - `/budgets` now only ever lists expense categories (a "budget" cap has no meaning for income); income categories (salary, or anything else pointed at real income) get their own section on `/income` instead, with a real year-to-date total
- [X] **"Reste à vivre"** summary on `/budgets` - total income minus total spending for the current month, internal transfers excluded, independent of how completely things are categorized
- [X] Considered and rejected: auto-detecting a category's type from that month's transactions (income vs expense framing would silently flip month to month) - an explicit, stable choice is the correct UX, not an inferred one

---

## v1.10.1 - Categorization & export fixes - Released ✓

*Two real issues found while validating v1.10.0 against production data.*

- [X] **Fix: internal-transfer matching now assigns pairs by global date-priority** instead of one credit at a time in arbitrary order - fixes a real case where an unrelated same-amount transaction could permanently claim the debit that was the true same-day match for a different transfer
- [X] **Fix: tax report export now shows 2 decimals per line** (dividends, interest, sale proceeds/gain/tax), matching what the page itself already shows - the export was rounding every line to the nearest euro, so a real 0,46€ dividend displayed as "0 €" in the downloaded file

---

## v1.10.2 - Accessibility & responsive-layout fixes - Released ✓

*Full visual pass over every page in desktop and mobile, verified with real screenshots rather than assumption - not one specific bug report this time, a systematic audit.*

- [X] **Fix: every navigation link now has a visible keyboard-focus ring** - only buttons and inputs had one before
- [X] **Fix: bank transaction/instrument labels no longer get silently cut off** on mobile with no way to read the full text - affected 11 different lists across the app
- [X] **Fix: table headers no longer wrap onto 2-3 lines** on narrow columns, across every table in the app
- [X] **Fix: unified page width** - three different content widths across pages produced a visible jump navigating between them
- [X] **Fix: consistent action-button styling** - pause/edit/delete buttons no longer mix icon-only and icon+text style in the same row, in 5 places
- [X] **Fix: the transactions table no longer overflows the viewport** on desktop because of a long button label
- [X] **Polish: simplified the dialog open/close animation** - fade + scale only, no more diagonal wobble from combining a scale and a slide

---

## v1.11.0 - Connect any Woob bank without a terminal - Released ✓

*Adding a bank via Settings → "Configurer Woob" that needed a 2FA confirmation on first connect used to be a dead end - the app pointed at a `--setup` command that didn't actually exist. LCL and Trade Republic already had a full in-browser setup flow for their own hardcoded integration; this generalizes the same flow to any of the hundreds of banks Woob supports.*

- [X] **Interactive 2FA setup for any Woob-configured bank** - the app now detects, per bank, whether it needs to wait for an app approval or a typed code (SMS/email/app-generated), and shows the right prompt directly in Settings instead of a broken CLI instruction
- [X] **Fix: banks needing a typed code (not just app approval) are now recognized at all** - previously fell straight into a generic, unhelpful error

---

## v1.11.1 - Full Woob catalog, searchable bank picker & institution-deletion fix - Released ✓

*Real-world testing of v1.11.0's new bank-connection flow surfaced a cluster of related gaps in the same area - fixed together rather than one release each.*

- [X] **Full Woob bank catalog everywhere** - "Ajouter une institution" carried its own separate hardcoded 17-bank list that never got wired to the live ~96-bank catalog `GET /woob/modules` already exposed for "Configurer Woob" - fixed so both bank pickers show the full catalog
- [X] **Searchable bank picker** - replaced the native `<select>` (which rendered as a browser dropdown covering nearly the whole screen with ~96 entries) with a compact, accent-insensitive search-as-you-type picker
- [X] **Fix: deleting a bank connection now actually deletes its accounts** - the confirmation dialog always promised this, but the underlying database relation silently detached accounts instead of removing them, leaving orphaned balances/transactions still counted in net worth with no way to manage them from Settings
- [X] **Fix: Woob sync controls no longer disappear for a bank named "LCL"/"Trade Republic"** - the dedicated `.env`-configured LCL/Trade Republic integrations and a user's own Woob-configured connection of the same name were being conflated, hiding the sync button, status, and config dialog entirely for the latter
- [X] **Fix: the dedicated auto-sync section only shows when actually configured** - it used to always display "Never synced" for LCL/Trade Republic even on installs with no `.env` credentials for either

---

## v1.11.2 - Warn before double-configuring a dedicated sync via Woob - Released ✓

*Real production incident found right after v1.11.1 shipped: configuring Woob credentials on an institution that also has an active `.env`-dedicated sync (LCL/Trade Republic) silently created a full second set of duplicated accounts.*

- [X] **Warn before configuring Woob on a dedicated `.env`-synced bank** - `sync_lcl.py`/`sync_tr.py` and `sync_woob.py` write different `syncId` formats for what can be the exact same real account, so neither sync path recognizes the other's rows as already-known. "Ajouter une institution" and "Configurer Woob" now show a warning banner (not a hard block - a deliberate, supervised migration off `.env` to Woob is legitimate) whenever the bank being configured matches an institution with an active `LCL_LOGIN`/`TR_PHONE` integration

---

## v1.11.3 - One-click cleanup for duplicate dedicated-sync accounts - Released ✓

*v1.11.2's warning banner only prevented new duplication going forward - it did nothing for a bank that had already been double-configured, which is exactly what happened in production on a real "LCL" institution running both the dedicated `.env` sync and a Woob config at once.*

- [X] **"Migrer maintenant" - one-click cleanup for duplicate `.env`-synced accounts** - once a Woob sync has produced its own `woob:<id>:`-prefixed accounts for a bank that also has legacy `lcl:`/`tr:`-prefixed accounts from the dedicated `.env` sync, "Configurer Woob" now offers to delete the old duplicates (full history cascades automatically) after showing both account counts side by side for confirmation. Deliberately available even after the `.env` credentials have already been removed - the whole point of removing them is to stop the duplication, so gating the cleanup tool behind them still being set would hide it exactly when it's needed most

---

## v1.12 - Integrations & platform - Released ✓

*Broader bank coverage, automation hooks, and better mobile experience.*

- [X] **More broker integrations via Woob - Degiro, Boursorama, Binance, Kraken** - already reachable today through the generic "Configurer Woob" flow shipped in v1.11.0-v1.11.3, no new code needed. Confirmed against Woob's own live module repository (not guessed): all four carry `CapBank` in their capabilities, same as any of the ~96 banks already listed in the picker
- [X] **Public REST API** - read-only, versioned under `/api/v1/` (`net-worth`, `net-worth/history`, `accounts`, `transactions`), authenticated via individually-revocable API keys (Settings → API) rather than the app password or a NextAuth session. Deliberately stops at these four endpoints for now, not a full data export - weighed directly against "profitable to the greatest number": the stated use cases (a Home Assistant sensor, a dashboard widget) are glanceable-summary consumers where budgets/holdings/analytics detail adds little real value but meaningfully raises the blast radius of a leaked key. See `CLAUDE.md`'s "Public REST API" for the full reasoning - more endpoints are additive on the same pattern if real usage asks for them
- [X] **PWA / installable, offline-capable** - proper 512×512 manifest icons (`any` + a correctly safe-zoned `maskable` variant - the previous manifest reused the same unpadded icon for both, which Android's mask would crop), plus a service worker for offline page viewing when `AUTH_ENABLED` isn't `"true"` (never falls back to a stale cached page when auth is on, to avoid bypassing a session that expired or was revoked server-side - see `CLAUDE.md`'s "PWA / offline support"). "Swipe-friendly views" from this item's original wording was dropped - no concrete gap was found, and the rest of the mobile-responsiveness work (touch targets, scrollable tables, the searchable bank picker) was already shipped incrementally in earlier releases
- [X] **Light theme** - opt-in only (Settings → Apparence), same cookie-based pattern as the language switcher - dark stays the default regardless of OS preference, never auto-switches from `prefers-color-scheme`. Every light-mode color pairing verified against the real WCAG contrast formula, not eyeballed - see `CLAUDE.md`'s "Light theme". Also caught and fixed a real gap this surfaced in `proxy.ts`'s auth matcher: several PWA-generated routes (icons, manifest, service worker) had no exclusion and would have been silently redirected to `/login` on an `AUTH_ENABLED=true` instance
- [X] **Richer read-only share view** - `/shared/<token>` now optionally shows holdings and the last 20 transactions, opt-in per link (`includeHoldings`/`includeTransactions`, both default off) since this link may be reachable from the public internet - see `CLAUDE.md`'s "Read-only share links"

*Three items from this version's original scope were deliberately dropped rather than shipped - each needs either real community demand or a materially bigger integration than the rest of this version, so they were moved to the Backlog section below instead of blocking v1.12 as "released": **Interactive Brokers**, **GoCardless webhooks**, **Plaid integration**.*

---

## v1.13 - Transaction visibility & budget depth - Released ✓

*A full feature-parity audit against Finary, Firefly III, Actual Budget, Monarch, and Kubera found the categorization/alerting layers already ahead of most of these - but two basics that nearly every one of them has were still missing entirely. Fixing the foundation before building further on top of it.*

- [X] **Global transaction ledger** (`/transactions`) - search and filter every transaction across every account by label, date range, amount, and category, instead of only per-account or via the `/budgets/[categoryId]` drill-down as today. No schema change - reads the existing `Transaction` table with the same `isInternalTransfer` exclusion and category filters already used elsewhere. The amount filter is a magnitude range (`|amountCents|` between min/max in euros, both optional) rather than a signed one - a user filtering "at least 50€" means either a big debit or a big credit, matching how every other magnitude-based threshold in this app already works (`AlertRule.balanceThresholdCents`, the uncategorized-groups sort). Not linked from the sidebar/mobile nav - same "off nav, linked contextually" precedent as `/tax-report` (see "Public REST API" above), reached instead via the new "View all transactions" link on each account's own transactions table
- [X] **Split transactions** - a single transaction across multiple categories (e.g. one supermarket trip: groceries + household goods), each split summing to the transaction's total (`TransactionSplit`, `lib/domain/transaction-splits.ts`'s `validateSplitLines`). `Transaction.categoryId` goes `null` once split - the breakdown lives entirely in `TransactionSplit` rows instead - so a real correctness fix had to go alongside this everywhere the app treats `categoryId: null` as "genuinely uncategorized": self-learning/MCC/dictionary auto-categorization now also requires `splits: { none: {} } }`, or a split transaction's manual categorization would have been silently overwritten the next sync cycle (confirmed live - a split survived an "Auto-catégoriser" run). `/budgets`, its `[categoryId]` drill-down, budget rollover, the `BUDGET_OVERRUN` custom alert, and `/income`'s "Autres revenus" totals all now also sum each category's `TransactionSplit` contribution alongside its plain-transaction one (`lib/domain/budgets.ts`'s `mergeCentsMaps`) - verified end-to-end against real numbers in a dev database, not just reasoned through. Also fixed a real pre-existing gap found while touching `BUDGET_OVERRUN`: it never filtered `isInternalTransfer: false` at all, unlike `/budgets`' own figure for the same category. See `CLAUDE.md`'s "Split transactions" for the full design
- [X] **Budget rollover** (opt-in per category) - unused envelope carries into next month instead of resetting to zero, matching YNAB's "give every dollar a job" model. Off by default (`Category.budgetRolloverEnabled`) so every existing budget keeps today's behavior. Only a positive leftover compounds forward, floored at 0 each month - a deliberately simpler, safer variant than YNAB's own model (which carries a negative balance forward as visible debt): an overspent month never creates a deficit the next month has to pay down first, matching the roadmap wording's own "instead of resetting to zero" framing, which only ever talks about surplus. `Category.budgetRolloverEnabledAt` anchors the walk-forward computation to when rollover was actually turned on (re-enabling after a pause starts a fresh carry, doesn't resurrect a stale one) and is left untouched on an already-on re-save, so editing an unrelated field (e.g. the budget amount) never resets an accumulated carry back to zero - confirmed live, not just reasoned through, in manual testing. See `CLAUDE.md`'s "Budget rollover" for the full math and why it's computed live from `Transaction` history rather than a maintained running balance

---

## v1.14 - Goals & long-term projection - Released ✓

*Turns "where did my money go" into "am I actually on track" - reuses the CAGR/savings-rate/runway math Analytics already computes, rather than building a new calculation engine from scratch.*

- [X] **Multiple named savings goals** - replaces `UserSettings.savingsGoalCents`'s single global figure with a `Goal` model (name, target amount, optional target date, optional linked account), so "down payment: 40k/80k" and "emergency fund: 8k/10k" can be tracked independently, each with its own progress bar. Migration backfills the existing global goal as the first row so nothing already in use is lost. `accountId: null` tracks total net worth (the old single goal's exact math); `accountId: <id>` tracks that one account's own current value instead, reusing `lib/domain/analytics.ts`'s existing per-account `assetRows` - verified live end-to-end (migration backfill exact-cents match, create/edit/delete, an account-linked goal's progress matching that account's real balance, and cascade-delete when the linked account is removed). See `CLAUDE.md`'s "Savings goals" for the full design
- [X] **Long-term net worth projection** - a compound-growth chart from current net worth, savings rate, and an assumed return, answering "at this pace, where am I in 10/20/30 years" - the one analytics gap against Finary's own "Vision" feature, the product this README already positions against directly. The assumed return is a live, client-side input (not a persisted setting) pre-filled from the portfolio's own real CAGR when available - a "what-if" exploration tool, recomputed instantly with no network round-trip. No schema change needed - every input (`netWorth`, `hasDeclaredSavings`, `monthlySavedCents`, `investCAGR`) already existed on `AnalyticsResult`. See `CLAUDE.md`'s "Long-term net worth projection" for the full design

---

## v1.15 - Mobile depth & a full UI/UX pass - Released ✓

*Closes the mobile gap without a native rewrite - stays inside the existing PWA architecture - then a systematic design audit now that the feature surface has grown well past the last one (v1.10.2), covering both older pages and the new transaction ledger/split UI/goals screens from v1.13-v1.14.*

- [X] **App-lock (WebAuthn biometric/PIN)** for the installed PWA - independent of `AUTH_ENABLED`, a fast local unlock layer for a device that's already trusted, matching what Finary/Monarch/Copilot's native apps offer without needing a native rewrite
- [X] **Web Push notifications** alongside ntfy - broader device support (iOS 16.4+, Android, desktop) without depending on a third-party push relay; existing ntfy/email configs keep working unchanged
- [X] **Full UI/UX audit** - a systematic pass in the same spirit as v1.10.2's (verified against real screenshots, not assumed), but broader in scope this time: visual hierarchy, empty states, loading states, and spacing consistency across every page, old and new. Screenshotted all 13 pages at 375px/1280px. Visual hierarchy, spacing, and empty-state coverage were already clean - `EmptyState` is used everywhere a real user-managed list needs one, and the sections that `return null` on empty (financing/dividend-calendar/top-assets/rebalancing/etc.) are correctly "not applicable" insights, not stubs. Two real gaps found and fixed: `/transactions` had no `loading.tsx` (was inheriting the dashboard-shaped root skeleton on a slow load - now has its own matching its real filter-bar/table/pagination layout), and its `max-w-5xl` (vs. every other page's `max-w-4xl`) was undocumented drift - confirmed deliberate and correct (it's the one page with a real 5-column table behind a 5-field filter bar) and now has a comment explaining why. A third candidate finding (`balance-history-table.tsx` silently dropping its CSV-import buttons when a fiat account's balance history is empty) turned out to be a false positive on cross-file check - `app/accounts/[id]/page.tsx` already renders a sibling `EmptyState` with its own copies of those buttons for exactly that case - left alone, just documented in a comment so a future read doesn't repeat the same mistaken conclusion
- [X] **"Auto" theme option, following the device's OS theme live** - a 3rd choice alongside today's Sombre/Clair, so the app follows the phone's own scheduled light/dark switch (e.g. light during the day, dark in the evening) without the user manually flipping it. Confirmed feasible and scoped by reading the current theme system, not assumed: today's `THEME` cookie + `data-theme="light"` override (`app/globals.css`, `app/layout.tsx`, `lib/actions/theme.ts`) is deliberately opt-in-only (see `CLAUDE.md`'s "Light theme" - dark never auto-switches from `prefers-color-scheme` today, by design, so an *existing* user never gets silently switched). Adding "Auto" as an explicit 3rd user choice doesn't contradict that decision, it's additive to it. The live-follow behavior (reacting to the OS changing theme while the tab is already open, this feature's actual point) is handled by the CSS `prefers-color-scheme` media query itself with zero JS - browsers re-evaluate it automatically the instant the OS setting changes, and it also has zero flash-of-wrong-theme on initial paint since it's resolved at CSS-parse time, before any JS runs. Needs: (1) a real `@media (prefers-color-scheme: light) { :root:not([data-theme]) {...} }` rule added to `globals.css` for the auto case, (2) a **new** `:root[data-theme="dark"]` explicit override (doesn't exist today - dark has only ever been the bare unconditional default, never something a user could force via attribute) so an explicit "Sombre" choice can still override a light-preferring OS once the media query exists, (3) `app/layout.tsx` rendering no `data-theme` attribute at all when `THEME=auto` (letting the media query win) instead of today's binary light/dark resolution, and (4) `generateViewport()`'s `colorScheme` becoming `"light dark"` (not a fixed value) in auto mode so native browser chrome (scrollbars, form controls) follows live too, not just the app's own tokens
- [X] **Clarify the "Répartition des actifs" cash-vs-savings split** - real user report, confirmed not a bug by reading `lib/domain/dashboard.ts` directly: the dashboard's allocation pie chart splits fiat balances into "Liquidités" (`CHECKING`/`MEAL_VOUCHER` accounts) and "Épargne" (`SAVINGS` accounts) rather than one combined slice - the exact same "a checking account earns 0%, unlike a livret" distinction `projection-chart.tsx` already makes explicit with its own `InfoTooltip`, but the dashboard chart never explains it, so a user with both account types has no way to tell why their money shows as two slices instead of one. Fix is small: add the same `InfoTooltip` pattern to this chart's section header

---

## v1.16 - Depth on existing strengths - Released ✓

*Levels up features already shipped and working rather than leaving them stalled at "good enough" once something more urgent came along - portfolio rebalancing, recurring detection, multi-currency, and the dashboard's allocation view each get one concrete, scoped next step.*

- [X] **Rebalancing drift alerts** - a 7th `AlertRule` kind ("this holding/account has drifted more than X points from its target"), reusing the existing 6-kind alert engine, instead of the rebalancing section only being visible on-demand on the account detail page
- [X] **Multi-interval recurring detection** - recognizes "every 2 months"/"every 3 months" cadences during auto-detection, not just `intervalCount = 1` as today (manual editing already supports any interval - only the detection heuristic itself is limited)
- [X] **On-demand multi-currency revaluation** - re-fetch the FX rate and price for a foreign-currency holding on request, on top of the existing snapshot-at-entry model, without needing to re-enter the native price by hand to trigger a refresh
- [X] **Historical asset-allocation chart** - extends the dashboard's current-moment allocation breakdown (liquidités/épargne/investissements…) into a stacked-area view over time, built from the same per-account `HistoricalBalance` rows already recorded - no new data collection needed
- [X] **Trade-Republic-style historical value chart per investment account** - a different, narrower ask than the dashboard-wide chart above: a smooth value-over-time line on the account-detail page for a single `INVESTMENT`/`CRYPTO` account, matching what Trade Republic's own app shows for a position. Real gap confirmed by reading the code: unlike fiat accounts (`HistoricalBalance` recorded daily), investment/crypto `HistoricalBalance` rows are event-driven - only written when a holding actually changes (see `CLAUDE.md`'s "Benchmark comparison" section) - so there's no daily series to chart today. Scoped before building: a synthetic daily series was rejected (no general ISIN→Yahoo-symbol resolver exists, only a 6-entry hand-verified map, and it would silently misrepresent any account traded since the charted start) in favor of the honest, accurate event-driven line with a clear "not enough data yet" state when sparse - see `CLAUDE.md`'s "Historical value chart per investment account" for the full scoping writeup
- [X] **Full sector-exposure breakdown** - generalizes Analytics' current Tech-only exposure card (`allocation-radar-section.tsx`'s `TECH_WEIGHTS`) into a per-sector view (financials, healthcare, energy, industrials, etc.) across every holding, not just one hardcoded sector. Scoped live before building: OpenFIGI (wrong data granularity) and iShares' own site (rebuilt, single-issuer-only) were checked and rejected; Yahoo Finance's free ISIN search + crumb-gated `topHoldings` covers it, with two optional fallback providers (FMP, Alpha Vantage) for resilience against the crumb mechanism breaking, plus a degradation alert reusing the existing sync-failure machinery. See `CLAUDE.md`'s "Full sector-exposure breakdown" for the full scoping writeup

---

## v1.17 - Sync freshness - Released ✓

*Scoped live during the v1.16.1 retrospective, not assumed - checked pytr's actual API, GoCardless's actual docs, and Powens' actual sync cadence before committing to anything here. The headline finding: true instant "just spent 5€" notifications only turn out to be achievable for Trade Republic, because its own API is genuinely push-capable (a persistent websocket, not batch polling) - LCL and every other Woob-scraped or GoCardless-synced bank has no equivalent mechanism to tap into, PSD2 aggregation being fundamentally batch/rate-limited on the bank's own side, not something this app's own engineering effort can route around. Scope here is set accordingly: real for Trade Republic, honestly partial for everything else.*

- [X] **Trade Republic real-time tracking** - not a push notification (Trade Republic's own app already sends one per purchase, a second notification from Finalibaba would be redundant) but keeping Finalibaba's *own* data current without waiting for the next 4h cron tick, so opening the dashboard/account page always shows what actually happened, not what happened as of the last sync. Confirmed live during scoping: the real Trade Republic API is websocket-based (`tr.subscribe(topic)` / `tr.recv()`, one initial response then a push on every change) - `sync_tr.py` today only ever uses this in a poll-once-and-disconnect fashion. Needs a new long-lived listener process (separate from the existing APScheduler cron, which stays as the fallback/catch-up path) that stays subscribed and upserts into the DB the moment an update arrives. **Also evaluate migrating off `pytr`'s Playwright-based WAF bypass while touching this module** - found during scoping that it's reportedly getting rate-limited by Trade Republic more often as of mid-2026, and a community successor (`tr-api`, proper ECDSA device-pairing auth, no browser automation) already exists - worth checking before building new functionality on top of a degrading approach.
- [X] **Reduced sync interval for Woob-synced banks** - shortened LCL/other Woob-scraped institutions' polling cadence from the 4h cron to **30 minutes** (picked directly with the user, weighing 15/30/60 min - a real, disclosed tradeoff, not a free win: more frequent scraping raises the risk of a bank's own anti-automation detection flagging the account), the realistic freshness ceiling for these sources given Woob has no push mechanism at all. Global, not per-institution, for this pass. **Deliberately excludes GoCardless-synced accounts** - GoCardless's own PSD2 rate limit (4-10 requests/day per account per endpoint, confirmed in `CLAUDE.md`'s "GoCardless" section) makes anything faster than the current cadence structurally impossible regardless of what this app does. See `CLAUDE.md`'s "Reduced sync interval for Woob-synced banks" for the full design (`sync/main.py`'s `_run_all()` split into `_run_woob_sources()`/`_run_all()`).
- [X] **New-transaction-detected alert** - a more honest, scoped-down version of the old "instant payment notifications" idea: notify (reusing the existing `dispatchAlert`/ntfy/email/push infrastructure) whenever any sync run - the new Trade Republic listener above, the shortened Woob poll, or a regular GoCardless cycle - discovers a genuinely new transaction. Freshness follows whatever that source's own sync cadence ends up being (near-instant for Trade Republic, 30 min for Woob, still every several hours for GoCardless) rather than promising uniform real-time across every source. Built as an 8th `AlertRule` kind (`NEW_TRANSACTION`) rather than a global toggle, per the user's explicit "perfectly customizable" ask - per-rule account scope, an optional minimum amount, and a debit/credit/both direction filter, so "notify me on any spending over 50€" and "notify me on any income" can coexist as two separate rules. See `CLAUDE.md`'s "Custom alert rules" for the full design (including why this kind needed its own cursor-based dedup instead of the shared threshold-crossing columns every other kind uses).
- [X] **Research: Powens as a bank-sync provider** *(carried over from the backlog, scope corrected)* - checked live during this retrospective: Powens syncs on its own schedule (up to ~4x/day by default) and its webhooks fire after that scheduled sync completes, not per real bank-side event - so it does **not** solve the traditional-bank instant-alert goal any better than GoCardless does. Researched specifically for **Trade Republic coverage/reliability** as scoped - **confirmed real** (Trade Republic has been part of Powens' "Wealth" crypto/trading data service since April 2022) and **architecturally compatible** with this project (a fully hosted API, deploy-time credentials, the same shape as GoCardless - no self-hosted infrastructure of their own to run). **Verdict: not worth building against, not for a technical reason** - Powens publishes no pricing and offers no free/self-serve production tier, only a sales-gated custom quote; a free sandbox exists but is for integration testing (a fake "Connecteur de test"), not a path to real production use without a sales conversation. That's a real accessibility barrier this project's other integrations (GoCardless's genuine free tier, Woob/pytr needing no account at all) don't have, and it cuts against the "`docker compose up` and a `.env` filled in under 5 minutes" goal for anyone without an existing commercial Powens relationship. Left here rather than promoted into a real version - revisit only if Powens ever publishes a self-serve tier, or a user with their own paid Powens contract asks for it directly.

---

## v2.0 - Multi-user - Released ✓

*Breaking architectural change: all data gains user ownership, requiring a migration. Planned as a dedicated, focused push once the single-user feature set (everything above) is mature and well-tested, rather than interleaved with it - multi-user plus a full security audit belong together, since every new sharing/permission boundary this adds is exactly the kind of surface a security review needs to cover anyway. A native mobile app may fold into this same push too, but only if it turns out to be genuinely worth the build effort relative to the PWA that already exists - not committed as of this writing, needs its own scoping pass first.*

- [X] **Multi-user support** - independent portfolios for multiple users on the same instance; admin-generated single-use invitations; whole-portfolio read-only sharing and per-account co-ownership. See `CLAUDE.md`'s "Multi-user architecture" for the full design and `README.md`'s "Multiple users" for the user-facing story
- [X] **Security audit** - ran as its own phase after the multi-user build. Three real fixes: `/invite/[token]` was missing from the middleware's auth-exempt list, so **the entire invitation flow was unreachable** on an `AUTH_ENABLED=true` instance; a 64ms timing gap in `resolveUser` was a working username-enumeration oracle; and `/api/gocardless/institutions` forwarded upstream error bodies verbatim to the caller. Full findings - including what was verified sound, and the items deliberately left open with reasons - are in `CLAUDE.md`'s "Security audit (post-v2.0)" section
- [X] **Native mobile app** *(scoped - recommendation: Capacitor, Play Store only, iOS self-built)*

**Native mobile app - scoping pass.**

*Brief, as set by the maintainer: one language/framework covering both platforms, published to the Play Store if the opportunity comes up, and **Apple deliberately dropped** - iOS users build it themselves from a tutorial.*

**The architectural constraint that decides the framework.** This app exposes **114 Server Action exports across 27 files** and only **4 public REST endpoints**. Server Actions are an RSC-internal RPC - they need the Next.js client runtime, a per-build action id and the `Next-Action` header - so **no native client can call them**. A React Native or Flutter app would therefore need a full authenticated REST API mirroring those 114 functions *before* a single screen was written, plus re-implementing all 14 pages. That is a larger project than the entire multi-user architecture, for a client that would then have to be kept in sync with every future action.

**Recommendation: Capacitor.** It wraps the existing app in a native WebView, so Server Actions, sessions, the service worker and every screen keep working unchanged - the thing being shipped is the app that already exists, not a reimplementation of it. It produces a signed Android App Bundle that Play Store accepts, and it generates a real Xcode project, which is exactly the "build it yourself" path iOS gets. Rejected alternatives: React Native/Flutter (blocked by the REST-API problem above), TWA (smaller output but Android-only and no native plugin surface).

**Apple is correctly dropped, and for a documented reason**: WebView wrappers are routinely rejected under App Store Guideline 4.2 ("minimum functionality"). Capacitor's Xcode project still builds and installs on a personal device, so a tutorial is a real answer rather than a consolation.

**The one piece of genuinely new work**: a self-hosted app has no single URL. One published APK must let each user point at *their own* instance, so the shell needs a first-run "enter your server address" screen persisting the URL before loading it - plus honest handling of the LAN/VPN-only and self-signed-certificate cases this project's own README already documents as normal deployments. Everything past that screen is the existing web app.

**Play Store friction worth knowing before committing** (checked, not assumed): a personal developer account is $25 one-time, but accounts created after 13 November 2023 must run a **closed test with 12 testers opted in for 14 consecutive days** before a production release. Still in force in 2026. That is the real gate on "if I get the chance to publish it", not the build.

**Shipped from this pass regardless of whether the app gets built**: the **Badging API** (`public/sw.js` + `service-worker-registration.tsx`), supported on iOS 16.4+ - the same gate Web Push already requires - and simply unused until now. An alert leaves a dot on the installed app icon, cleared when the app is next opened or resumed. Called with no count deliberately: this app dispatches alerts but stores no read/unread state, so any number would be invented.

*Correction to an earlier draft of this section, kept as a warning.* Several 2026 guides still list "EU: push notifications disabled, standalone mode removed, badges removed" as a live iOS restriction. That was Apple's **announced-then-reversed** plan, withdrawn on 1 March 2024; home-screen web apps work normally in the EU on iOS 17.4+. Taking it at face value would have described this project's own primary audience as running a crippled PWA.

**Retrospective on the multi-user build.** Shipped in four gated lots (identity and migration; per-user isolation; sharing; documentation), each verified against a real two-user database rather than only unit-tested.

The decision everything else rests on: the migration creates a **fixed-id owner row and backfills every existing row to it**, so there is no `userId | null` anywhere and no "is multi-user on?" branch inside any query. Mono mode resolves to that row without a login. That single choice is what makes the mono-mode guarantee provable instead of hopeful, and it makes the day-180 switch (an instance that ran solo for months and only now turns auth on) attach its history to the admin *by construction* - the bootstrap screen only sets credentials on a row that already owns everything.

Three real security holes were found and fixed **while building**, not by the audit that follows:

- `getUserSettingsFor(userId)` was exported from a `"use server"` module and returned the row holding `smtpPassword` and `ntfyAuthToken` in plaintext. Every export of such a module is directly invocable from the browser with attacker-chosen arguments, so this would have handed any authenticated user every other user's alert credentials.
- `/api/gocardless/connect` had no ownership check at all - anyone with a session could start a bank-consent flow against another user's institution.
- The read-only share view (`/shared/[token]`) queried balances instance-wide, so a link minted by one user would have exposed everyone's net worth.

The generalizable lesson is the first one: **a userId parameter on a `"use server"` export is an impersonation primitive.** A scripted check for that shape is worth re-running whenever an action file gains a parameter.

Two things were deliberately *not* built, and are scoped out rather than forgotten: fractional ownership of a co-owned account (each co-owner counts the full value in their own view - this is a per-viewer dashboard, not a fiscal filing), and per-account grants to non-co-owners (sharing is whole-portfolio or nothing). Open self-registration is also deliberately absent; revisit after the security audit, not before.

---

## v2.1 - Per-user bank connections - Released ✓

*v2.0 gave every user their own portfolio but left the bank credentials behind: `LCL_LOGIN`/`TR_PHONE` live in `.env`, so they belong to the instance owner and nobody else can sync their own accounts. That was a documented, accepted constraint of that release. It is also the first thing real users hit, because inviting family only helps if they can actually connect their own bank.*

- [X] **Per-user Trade Republic** - add a Trade Republic account from Settings, the way Woob institutions already work, so every user can connect their own (and more than one). Before this it was impossible by architecture rather than configuration: `sync_tr.py` read `TR_PHONE`/`TR_PIN` from the environment, a single value for the whole instance, with no per-institution equivalent of Woob's `woobLogin`/`woobPassword`. See `CLAUDE.md`'s "Per-user Trade Republic" for the full design.

  **The blocker, solved first and before any UI**: `sync_tr.py` wrote fixed account identifiers (`tr:cash`, `tr:pea`, `tr:cto`, `tr:crypto`), and `Account.syncId` is globally unique - two users each with a Trade Republic cash account collide on the very first insert, and the second silently overwrites the first's. They are now `tr:<institutionId>:cash` on the per-user path, mirroring `woob:<institutionId>:<id>`, while the `.env` path keeps writing the legacy two-segment id so existing rows are untouched. `lib/domain/sync-ids.ts` is the one place that shape is parsed, precisely so the next reader of a `syncId` cannot get it subtly wrong.

  **The unknown that could have sunk this settled favourably.** Read against the exact commit `requirements.txt` pins (`1cff3d70`), not a local install: `TradeRepublicApi.__init__` takes a `cookies_file` parameter, and when it is omitted the path defaults to `cookies.<phone_no>.txt` rather than a single fixed file. So two users never share a session even by accident, and passing the parameter explicitly (which the per-institution path does) gives deterministic control. No process or working-directory isolation was needed.

- [ ] **Per-user LCL and other env-configured syncs** *(follows from the above)* - the same treatment for the remaining `.env`-driven integration, now that the Trade Republic work has established the pattern. Lower priority: LCL is already reachable per-user through the generic Woob picker, so this is about removing a special case rather than unblocking anyone.

**Retrospective.** Shipped in five gated lots: the syncId namespacing (with its own tests before a single line of sync code changed), the per-institution sync path, the interactive setup flow and route dispatch, the Settings UI, and documentation.

**The namespacing alone did not actually fix the collision, and only a real database proved it.** After `sync_tr.py` was writing `tr:<institutionId>:cash`, a two-user test still produced **one shared row**. The cause was `upsert_account`'s native-id fallback in `sync/db.py` - a `LIKE '%:<native_id>'` lookup added after the v1.11 LCL/Woob duplicate-account incident, which matches on the trailing colon segment. For Woob that segment is a unique bank-side account id, which is what makes the fallback correct there. For Trade Republic it is an account *kind* (`cash`), shared by every user on the instance, so the fallback confidently matched two different people's accounts as the same one. Fixed by exempting Trade Republic ids from that fallback specifically, and re-verified that the LCL/Woob dedup it exists for still works. A unit test would not have caught this: both writes were individually correct, and the bug lived in the third function that read them back.

**One provider per institution, decided at the point of choice.** `setWoobConfig` and `setTradeRepublicConfig` each clear the other's credential fields. Without that, an institution could hold both, and which backend actually ran would depend on the order of two `if`s in the sync service rather than on anything the user chose - a silent, order-dependent outcome nobody selected. The Settings row follows the same rule: both configuration buttons appear while nothing is set up (that is the real choice), and only the configured provider's remains afterwards.

**What deliberately did not change**: `setup_tr.py`, `sync_tr.py`'s `run()`, and the `TR_PHONE`/`TR_PIN` environment path all keep working exactly as before, the same way `setup_lcl.py` was left alone when `setup_woob.py` generalised the Woob path in v1.12. An instance that never touches the new UI cannot tell this release happened.

---

## v2.3 - Real-time for every connection, and a UX pass on getting there - Released ✓

*v2.1 gave every user their own Trade Republic connection, but real-time tracking - the persistent websocket listener that keeps balances moving without waiting for the 4h cron - stayed hardcoded to the `.env` connection alone, "a real scoping decision rather than a line of plumbing" at the time. The same release then invited users to migrate off `.env` entirely. Nobody priced what happens when a feature is left on a path a later release retires.*

- [X] **A per-user sync did not refresh that user's open tabs.** `/api/realtime/notify` was only ever called by `sync_tr_realtime.py`, which follows the `.env` connection, so the owner's tabs live-updated and nobody else's did. `sync/main.py`'s `_notify_owner()` now fires after every successful per-institution Woob or Trade Republic sync, addressed to that institution's owner. Best-effort throughout: a refresh that does not arrive costs a manual reload and must never turn a successful sync into a failed one.
- [X] **Moving off `.env` silently ended real-time updates.** The listener was started only `if TR_PHONE and TR_REALTIME_ENABLED`, so completing the per-user migration v2.1 invited stopped it - no error, no log line, no indicator, just a portfolio back to moving every four hours. One listener per connection now, supervised, plus a Settings indicator that says whether each one is actually running. See `CLAUDE.md`'s "Per-user real-time listeners", including why this is a different bug class from the ones the release audit already tracks: nothing in the listener was wrong, it was keyed on a path the data had left.
- [X] **The Trade Republic reconnection flow was cramped and went quiet at the end.** The code panel rendered into the institution row's right-hand button cluster, which is a `flex-wrap` sized to its buttons, so it was squeezed into whatever width was left. And confirming the code reset the component, put the "Connecter" button back, and left the first sync running invisibly until the row abruptly said it was synced. It is a dialog now, running the whole ceremony - request, code, sync - through to a stated result, with a step indicator and a named wait at each stage.
- [X] **Two v2.1 leftovers of the same shape**, both the `woob:`-only assumption surviving a release that added a second per-institution prefix: a Trade Republic sync failure was announced by its raw cuid, and a removed Trade Republic connection kept reminding "still broken" every 24h with no way to clear itself.

**Retrospective.** The headline bug is not the same shape as the recurring patterns the release-boundary audit already tracks (a heuristic inferring identity from a string segment, a thrown error redacted in production) - it is new: **a feature can be broken by a migration it does not participate in.** Nothing in `sync_tr_realtime.py` was wrong on its own terms. The `.env` path it followed was simply no longer the path the data took once a user finished the v2.1 migration, and the gate joining the two lived in a third file (`main.py`'s boot condition). Worth watching for again: whenever a release moves users from path A to path B, what else on A was never re-checked against B?

The fix turned a single hardcoded task into a small supervisor - connections are configured, reconnected and deleted while the process runs now, not just once at boot - with three properties load-bearing enough to each get their own test: a stopped listener is never retried on a timer (retrying a dead Trade Republic session every minute is exactly the traffic pattern that gets an account flagged), reconnecting from Settings is the only thing that lifts that stop, and a failed database read leaves every running listener alone rather than tearing all of them down on one transient error.

A real user report ("many components do not update when you change them") turned into a genuine finding of a different kind: **not reproduced**, and the reason is worth keeping. `revalidatePath`'s own documentation implies the specific path matters; three measurements against a production build showed it does not, in this app - every page is `force-dynamic`, so any revalidation refreshes whatever route is on screen regardless of which path was named. Nine real edit flows were then exercised end to end and all refreshed correctly. Nothing was "fixed" on a guess; a test now asserts the one mechanism that is known to cause the symptom (a mutation that revalidates nothing at all), and the report stays open pending a screen and an edit that actually reproduces it.

## v2.5 - Captcha banks can be connected by a human - Released ✓

*Issue #51 reported Amundi as a stack trace. v2.4.1 fixed the traceback by classifying captchas as `unsupported`, reasoning that a captcha exists precisely to defeat automation. That reasoning was wrong, and it is the kind of wrong that sounds final: the bank is refusing a robot, and the answer is to stop being one for one screen rather than to give up. Reading the module settled it in a single look - it raises only when nothing has filled in `captcha_response`, and logs in normally once something has.*

- [X] **A captcha is now solved by the person, in Settings.** The exception already carries the reCAPTCHA site key for exactly this purpose. The flow reuses the OTP plumbing verbatim - `captcha_response` is just another config field id, so the solved token travels through the same `code` parameter an SMS code does and `complete_setup` needed zero changes. Verified against the real Amundi module: a live key, the real Google checkbox rendered in the app, Confirm disabled until it is ticked, zero CSP violations.
- [X] **A captcha bank was being told to give up.** `unsupported` hid the Connect button on a bank that in fact works. It now reports `captcha_required`, which is its own status because the two existing ones are each wrong in a *different* direction: `unsupported` hides the button, and `auth_required` would have the failure alert remind the user every 24h **forever**, since no scheduled run can ever satisfy a captcha. Two questions, two predicates, and a test pinning that `captcha_required` is the only status answering yes to both.
- [X] **The alert says its piece once and stops.** Worth one notification - unlike `unsupported`, there is something the user can actually do - and its body says both what to do and that the automatic sync will not do it. The state row is kept rather than cleared, because it is what suppresses every later reminder.
- [X] **A refused captcha no longer reports success.** `complete_setup`'s return goes straight back as a 200, so a token that expired (they last about two minutes) would have announced a connection that never happened. It raises now, and the browser drops back to the Connect button rather than leaving one whose only possible outcome is the same error.
- [X] **`error-callback` was treated as fatal.** It fires on a transient network hiccup that the widget recovers from by itself; tearing the panel down replaced a working checkbox with "the captcha could not load", observed happening to a widget that had in fact loaded.
- [X] **The four-way status branch existed three times** in the settings page - colour, aria-label, icon - so adding a status meant editing one decision in three places. One function now, with the tone and icon tables side by side.

**The honest limit, and how nearly it was missed.** Amundi's site key **restricts its allowed domains**, so Google refuses to render it on a self-hosted origin. Measured across three origins with the same key: `localhost` renders the checkbox, `127.0.0.1` is refused, and a realistic `finalibaba.example.com` returns "Domaine non valide pour la clé de site reCAPTCHA". So for Amundi this works only when the app is reached at `localhost` - a leftover in *their* allow-list, not something to rely on. An earlier note in `CLAUDE.md` claimed the opposite, because the check scanned for the English "Invalid domain" on a page rendering in French and concluded "no errors". **A negative result from a string match is only as good as the string**; the probe now asserts on the presence of the `.recaptcha-checkbox` element instead.

Shipped anyway, with the failure explained rather than hidden: the restriction is per-bank, so a captcha bank with an unrestricted key works fully on any domain (verified), and where it cannot work the user sees Google's own localised error plus a line saying it is the bank's restriction and not their misconfiguration. Declaring the bank's origin to defeat the check - what commercial solving services effectively do - would make it work everywhere and is **deliberately not done**: it is circumventing a control the bank configured, which is a different thing from clicking a checkbox yourself. Whether Amundi's *backend* even verifies the token is still unproven; the login endpoint answers a bare 403 for a bad password and (apparently) for a bad captcha alike, and Woob's own module collapses both into "wrong password" because there is no other way to tell.

---

## v2.4.3 - Real-time subscribes to topics that exist - Released ✓

- [X] **Two of the three real-time topics were not topics.** With v2.4.2's receive loop fixed, the listener reached a real Trade Republic answer for the first time: `BAD_SUBSCRIPTION_TYPE: Unknown topic type: neonPortfolio.31`. Neither `neonPortfolio` nor `cryptoPortfolio` appears in pytr's vocabulary; only `cash` was ever real. The rejection arrives asynchronously and killed the whole session, so the listener reconnected forever. Now `cash` plus `compactPortfolioByType` per securities account (the pair the working 4h sync proves TR accepts), a subscription step that keeps whatever TR actually answers so a future vocabulary change costs coverage rather than the feature, and a 30s floor between fetch cycles so a chatty topic cannot cause a fetch storm.

---

## v2.4.2 - Real-time tracking actually works now - Released ✓

- [X] **The real-time listener had never processed a single push.** It ran one receive task per subscribed topic, which is several concurrent reads on one websocket, which the library forbids. It raised on the first iteration every time, so it connected, logged "listening on [...]", died and reconnected in a loop. Shipped in v1.17 and survived four releases because the success log line is emitted before the code that fails, an ordinary reconnect warning looks the same as a blip, and the tests faked the one function containing the bug. One `recv()` per iteration replaces the whole thing, since the client already multiplexes. Tests now drive the real loop and fail against the old one.

---

## v2.4.1 - Banks that cannot be synced now say so - Released ✓

- [X] **A captcha-protected bank produced a stack trace** (issue #51, Amundi). `setup_woob.py` already classified captchas, browser redirects and "do this on our site" actions as unsupported; the sync path did not, so they landed in the generic error handler. Now a distinct `unsupported` status with a readable message, deliberately not `auth_required` (which would send the user round a setup loop that cannot succeed), and the alert machinery stops reminding daily about a bank that can never work. Reproduced independently on a second Amundi account.
- [X] **Four new HIGH `fast-uri` advisories.** The existing override floor (`>=3.1.5`) was satisfied by 4.1.2, which every one of them still hits; raised to `>=4.1.3`. Same never-invoked `prisma dev` chain as before, bumped rather than exempted because it costs nothing.

---

## v2.4 - Audit fixes, and the app stops assuming France - Released ✓

*A full audit (data security, cross-user isolation, UI/UX, performance, features, monetisation) run against a real two-user instance rather than by reading code. Isolation held on every assertion, including the escalation case - a read-only guest cannot turn a live grant into an API key or a share link that carries the grantor's data. Seven defects came out of it, none blocking, all fixed here.*

- [X] **A share link showed the app-lock screen to a stranger.** `AppLockGate` wrapped everything in the root layout with no bare-route guard, unlike the sidebar, `MainContent` and `AutoSync`. Worse on `/shared/*` specifically: an anonymous visitor has no session, so `getViewer()` falls back to the instance owner and it was the *owner's* lock setting gating a link they had deliberately published.
- [X] **No timeout on any outbound market-data call.** `/analytics` is a Server Component that awaits Yahoo, FX and the sector fallbacks in sequence; a provider that *hangs* (rather than fails) blocked the render indefinitely. The same lesson `lib/actions/sync.ts` learned from a real spinning-button report, never applied here. Now one `fetchExternal` helper with a deadline, covering GoCardless and ntfy too.
- [X] **Real estate rendered in the same grey as "unclassified".** On a typical French portfolio it is the largest holding, so the biggest wedge of the donut read as missing data. Now terracotta - 31° clear of crypto's amber, 37° of automobile's pink, and five times the saturation, so it reads as a category rather than an absence.
- [X] **A zero change displayed as a green gain.** "▲ 0 € (+0.0%)" on the dashboard's hero figure. Three states now, not two.
- [X] **`checkSyncFailures` ran three queries per source per user**, sequentially, inside a route that already loops per user. Batched into three total.
- [X] **A guard `CLAUDE.md` described did not exist.** H4 claimed the alert checkers defensively ignore rules on unreachable accounts; `checkNewTransactionRule` used `rule.accountId` unchecked. Not exploitable - every path that could orphan a rule cascades or cleans it - but written now rather than left as a doc-vs-code divergence.
- [X] **Sonar suppression count had drifted again** (10 documented, 11 real). Second time; the note now says to re-count rather than trust the number.

- [X] **Deleting a recurring transaction brought it straight back as a suggestion.** Reproduced: 7 suggestions, delete one, 8 suggestions, no way out. `detectCandidates` suppresses a pattern by finding a row that still exists, so deleting removed the only thing holding it back. `dismissedAt` is the tombstone; a separate action really removes it. Same field also stops a dismissed suggestion appearing in the visible list wearing a "Paused" badge - dismissing used to make the page longer.
- [X] **A dismissal now expires when the pattern stops and comes back.** The first fix made "stop suggesting this" permanent, which would have silenced a resubscribed service forever. The signal is a gap of 3+ quiet cycles, not merely new charges - a subscription that never stopped also keeps billing, and re-suggesting that is the nagging the dismissal exists to end.
- [X] **`/recurring` led with suggestions.** Projection first now, then the templates you manage, then suggestions (collapsed unless you have none), then hidden ones.
- [X] **`/settings` was 6800px of 22 sections in historical order.** Regrouped by subject: data sources, then identity and security together (the password used to sit ~3000px down between share links and portfolio grants), then financial parameters, sharing, notifications, appearance last.
- [X] **Co-ownership was buried below the transactions table.** Up to 200 rows of scrolling to reach it, and invisible to anyone who did not already know it existed - which for a sharing feature means it may as well not be there. It is a header control now, next to rename, showing the co-owner count so the header states whether an account is shared rather than only offering the action.
- [X] **A suggested rate now carries the date it was known.** Raised directly: the Livret A is at 1.5% and about to move to 1.7%. That exposed the preset perpetuating the exact problem it was meant to fix - a hardcoded rate with no date is indistinguishable from one the user verified. It is dated in the code and printed in the form now. An unset rate is also *visible* instead of silently zero, and the export discloses how many accounts it could not count - `annualInterestCents` appears nowhere in the UI, only in that export, so a shortfall had no way of being noticed.
- [X] **The fiscal model stops being French-only.** `taxTreatment`/`taxRatePct` was already country-agnostic and stayed; what changed is everything that bypassed it. The savings-interest estimate matched account *names* against French products on every render, so an account anywhere else silently contributed zero passive income - it is a real `Account.interestRatePct` column now, backfilled from the old rules so no French figure moves. `UserSettings.country` drives which wrappers and rates get *suggested* (PEA/CTO, ISA/SIPP, Roth IRA/401(k)…) and never what is computed. Deliberately **not** a tax engine: several countries carry a null rate on purpose, because a confidently wrong tax figure is worse than an empty field. See `CLAUDE.md`'s "Country presets, and why there is no tax engine".

**Still open from the audit**, logged rather than fixed: the rebalancing view stops at a diagnosis instead of pre-filling the trade dialogs; exports still flatten split transactions; LCL remains an env special case now that Trade Republic has a per-user path; and `dividendEffectiveTaxRate` plus the Trade Republic cash fallback are still French-specific, though both are now overridable per account. The largest single risk is unchanged and unrelated to any of the seven: `pytr`'s Playwright-based WAF bypass, which real-time now depends on, and which the v1.17 scoping already flagged as degrading.

---

---

## UI/UX polish - noted from real usage

*Small, real annoyances found while using the app on a live instance. Not urgent, not forgotten. Grouped here rather than scattered so a future pass can take them together.*

- [X] **Sharing a portfolio with an unknown username showed a raw error.** The messages existed and were in French; they were *thrown*, and production replaces a thrown Server Action error with an opaque digest, so what reached the screen was an unreadable internal error. Returned as keys now, translated by the caller, with an empty input distinguished from an unknown user. This path remains the username oracle noted in `CLAUDE.md`'s post-v2.0 audit (item 4) - a readable message does not make it more of one, and tests pin that the failure never echoes the name that was looked up.
- [X] **A co-owned account did not say whose it is.** The account detail header now carries a "Compte de {name}" chip when the account belongs to someone else, shown only with auth on and only when the owner differs from the viewer, where it would otherwise be noise.
- [ ] **"Many components do not update when you change them."** Reported from real usage, and **not reproduced**: nine real edit flows were exercised in a production build and every one refreshed correctly. The investigation did settle the mechanism (see `CLAUDE.md`'s "Revalidation, and what actually makes a screen update" - the obvious explanation was measurably wrong) and added a test asserting every mutating Server Action revalidates something, which is the one cause known to produce this. Left open pending a specific screen and edit to reproduce.

---

## Backlog - demand-driven

*Not scheduled into a version. Each of these was scoped out of the version it originally belonged to (see that version's own retrospective note) because it needs either confirmed community demand or a materially bigger integration effort than the rest of that version - not because it was forgotten. Move an item here into a real version once that condition is met.*

- [ ] **Interactive Brokers** - the one broker from the original v1.12 list with genuinely no Woob module (confirmed absent from the live repository, same way Revolut was confirmed absent - see `CLAUDE.md`'s "Sync service" section). Would need a real direct-API integration (IBKR's Client Portal/TWS API, which means running and managing an IB Gateway session) rather than just a picker entry
- [ ] **GoCardless webhooks** *(downgraded from a planned item - re-checked live during the v1.17 scoping pass above)* - the webhook/event documentation findable for GoCardless is under its Payments (mandates, billing requests) product, not the Bank Account Data (PSD2 account-info) product this project actually integrates with; a transaction-level webhook for Bank Account Data specifically could not be confirmed to exist at all from public docs. Would also still need the self-hosted instance reachable from the public internet either way (the opposite direction of the existing polling sync). Left here rather than promoted, pending someone actually checking with a real GoCardless account
- [ ] **Plaid integration** - US and Canadian banks (only if there is clear community demand)

---

## v1.0.0 - Released ✓

- [X] `docker compose up` one-command setup
- [X] All account types: checking/savings, PEA/CTO, crypto, real estate, automobile, loan, meal vouchers
- [X] Live prices via Yahoo Finance (stocks, ETFs, crypto)
- [X] French tax calculations - latent taxes: PEA 17.2%, CTO 31.4%, Crypto 31.4%
- [X] Analytics: savings rate, runway, passive income, CAGR, sector allocation, benchmark radar
- [X] Auto-sync: Trade Republic (18 EU countries), LCL via Woob, generic Woob for other FR banks
- [X] GoCardless PSD2 open banking - 2,200+ banks across EU and UK
- [X] Optional built-in password authentication (`AUTH_ENABLED=true`)
- [X] CSV and PDF export
- [X] Demo mode - pre-seeded fictional data, read-only (`DEMO_MODE=true`), cron reset
- [X] WCAG 2.1 accessibility (keyboard navigation, screen reader, focus management)
- [X] AGPL-3.0 open-source release *(that licence governed every release through v2.0.1; see LICENSE.md for what applies after)*
