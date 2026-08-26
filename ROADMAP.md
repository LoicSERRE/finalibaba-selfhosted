# Roadmap - Finalibaba Self-Hosted

Current stable release: **v1.15.1**

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

## v1.16 - Depth on existing strengths

*Levels up features already shipped and working rather than leaving them stalled at "good enough" once something more urgent came along - portfolio rebalancing, recurring detection, multi-currency, and the dashboard's allocation view each get one concrete, scoped next step.*

- [X] **Rebalancing drift alerts** - a 7th `AlertRule` kind ("this holding/account has drifted more than X points from its target"), reusing the existing 6-kind alert engine, instead of the rebalancing section only being visible on-demand on the account detail page
- [X] **Multi-interval recurring detection** - recognizes "every 2 months"/"every 3 months" cadences during auto-detection, not just `intervalCount = 1` as today (manual editing already supports any interval - only the detection heuristic itself is limited)
- [X] **On-demand multi-currency revaluation** - re-fetch the FX rate and price for a foreign-currency holding on request, on top of the existing snapshot-at-entry model, without needing to re-enter the native price by hand to trigger a refresh
- [X] **Historical asset-allocation chart** - extends the dashboard's current-moment allocation breakdown (liquidités/épargne/investissements…) into a stacked-area view over time, built from the same per-account `HistoricalBalance` rows already recorded - no new data collection needed
- [ ] **Trade-Republic-style historical value chart per investment account** - a different, narrower ask than the dashboard-wide chart above: a smooth value-over-time line on the account-detail page for a single `INVESTMENT`/`CRYPTO` account, matching what Trade Republic's own app shows for a position. Real gap confirmed by reading the code: unlike fiat accounts (`HistoricalBalance` recorded daily), investment/crypto `HistoricalBalance` rows are event-driven - only written when a holding actually changes (see `CLAUDE.md`'s "Benchmark comparison" section) - so there's no daily series to chart today. Needs real design work before building: either compute a synthetic daily value series (holdings quantity history × daily price lookups, likely via the existing Yahoo Finance fetch) or accept a coarser event-driven line and be upfront about the difference - don't assume the answer, scope it properly first
- [ ] **Full sector-exposure breakdown** - generalizes Analytics' current Tech-only exposure card (`allocation-radar-section.tsx`'s `TECH_WEIGHTS`) into a per-sector view (financials, healthcare, energy, industrials, etc.) across every holding, not just one hardcoded sector. Scoped out of v1.14.1 rather than built alongside the Tech card's ISIN-mismatch fix: `TECH_WEIGHTS` itself is a small, individually-verified-by-hand map (each ISIN checked against a real prospectus/fund fact sheet, not guessed) - a full GICS-equivalent sector taxonomy across every sector would need either a real per-ISIN sector data source (none currently in the stack, and no free/reliable one confirmed yet) or the same one-by-one manual verification discipline applied to several sectors' worth of holdings instead of one. Scope the data-sourcing question with real user holdings before building, same "verified, not fabricated" bar `TECH_WEIGHTS` was held to

---

## v2.0 - Multi-user

*Breaking architectural change: all data gains user ownership, requiring a migration.*

- [ ] **Multi-user support** - independent portfolios for multiple users on the same instance; role-based access (owner / read-only guest)

---

## Backlog - demand-driven

*Not scheduled into a version. Each of these was scoped out of the version it originally belonged to (see that version's own retrospective note) because it needs either confirmed community demand or a materially bigger integration effort than the rest of that version - not because it was forgotten. Move an item here into a real version once that condition is met.*

- [ ] **Interactive Brokers** - the one broker from the original v1.12 list with genuinely no Woob module (confirmed absent from the live repository, same way Revolut was confirmed absent - see `CLAUDE.md`'s "Sync service" section). Would need a real direct-API integration (IBKR's Client Portal/TWS API, which means running and managing an IB Gateway session) rather than just a picker entry
- [ ] **GoCardless webhooks** - real-time balance updates instead of polling every 4 hours. Narrower value than it first appears: needs the self-hosted instance to be reachable from the public internet (the opposite direction of the existing polling sync, which only makes outbound calls) *and* GoCardless usage specifically - many self-hosters run LAN/VPN-only with no public exposure at all, so this would be unusable for them regardless of GoCardless adoption
- [ ] **Instant payment notifications** - a push notification the moment a new transaction lands (what Trade Republic's own native app already does, unlike this project's user's regular bank) - reusing the existing `dispatchAlert`/ntfy/email infrastructure with a new "new transaction" trigger, not new delivery infrastructure. Explicitly blocked on real-time sync existing first: every sync source today (GoCardless polling, Woob, pytr) only refreshes on the 4h cron or a manual "Sync now" click, so there's no event to notify on the moment it actually happens - depends on the "GoCardless webhooks" item above (or an equivalent push-capable source, Trade Republic's own API has no documented webhook/push mechanism either) landing first
- [ ] **Plaid integration** - US and Canadian banks (only if there is clear community demand)
- [ ] **Research: Powens as a bank-sync provider** - a commercial account-aggregation API reportedly used by Finary itself, and reportedly covering Trade Republic (unlike GoCardless's own PSD2 coverage - see "GoCardless" in `CLAUDE.md`). Research only for now, no code: pricing and whether a free/open tier exists, EU/FR bank coverage vs. Woob's own catalog, and self-hosted feasibility (an API key model like GoCardless's, or something that assumes a SaaS backend this project's self-hosted-first model wouldn't fit) - decide whether it's worth building against only after that's actually confirmed, not assumed

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
- [X] AGPL-3.0 open-source release
