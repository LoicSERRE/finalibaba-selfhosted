# Roadmap - Finalibaba Self-Hosted

Current stable release: **v1.11.3**

Versions follow [Semantic Versioning](https://semver.org). Minor versions (1.x) are additive and backwards-compatible. v2.0 is a breaking architectural change (multi-user).

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

## v1.12 - Integrations & platform

*Broader bank coverage, automation hooks, and better mobile experience.*

- [X] **More broker integrations via Woob - Degiro, Boursorama, Binance, Kraken** - already reachable today through the generic "Configurer Woob" flow shipped in v1.11.0-v1.11.3, no new code needed. Confirmed against Woob's own live module repository (not guessed): all four carry `CapBank` in their capabilities, same as any of the ~96 banks already listed in the picker
- [ ] **Interactive Brokers** - the one broker from the original list with genuinely no Woob module (confirmed absent from the live repository, same way Revolut was confirmed absent - see `CLAUDE.md`'s "Sync service" section). Would need a real direct-API integration (IBKR's Client Portal/TWS API, which means running and managing an IB Gateway session) rather than just a picker entry - kept demand-driven given that added complexity
- [ ] **GoCardless webhooks** - real-time balance updates instead of polling every 4 hours
- [ ] **Public REST API** - read-only API endpoints for external tools (Home Assistant, custom dashboards, mobile widgets)
- [X] **PWA / installable, offline-capable** - proper 512×512 manifest icons (`any` + a correctly safe-zoned `maskable` variant - the previous manifest reused the same unpadded icon for both, which Android's mask would crop), plus a service worker for offline page viewing when `AUTH_ENABLED` isn't `"true"` (never falls back to a stale cached page when auth is on, to avoid bypassing a session that expired or was revoked server-side - see `CLAUDE.md`'s "PWA / offline support"). "Swipe-friendly views" from this item's original wording was dropped - no concrete gap was found, and the rest of the mobile-responsiveness work (touch targets, scrollable tables, the searchable bank picker) was already shipped incrementally in earlier releases
- [ ] **Light theme** - optional light colour scheme (currently dark only)
- [ ] **Plaid integration** - US and Canadian banks (only if there is clear community demand)
- [X] **Richer read-only share view** - `/shared/<token>` now optionally shows holdings and the last 20 transactions, opt-in per link (`includeHoldings`/`includeTransactions`, both default off) since this link may be reachable from the public internet - see `CLAUDE.md`'s "Read-only share links"

---

## v2.0 - Multi-user

*Breaking architectural change: all data gains user ownership, requiring a migration.*

- [ ] **Multi-user support** - independent portfolios for multiple users on the same instance; role-based access (owner / read-only guest)

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
