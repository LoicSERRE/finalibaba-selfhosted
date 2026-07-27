# Roadmap - Finalibaba Self-Hosted

Current stable release: **v1.3.1**

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

## v1.4 - Advanced analytics & international fiscal support

*Power features for investors, and making the tax layer work correctly regardless of where you live.*

- [x] **Benchmark comparison** - overlay portfolio CAGR against a reference index (MSCI World, S&P 500, CAC 40)
- [x] **Portfolio rebalancing** - define a target allocation per account, show current drift, suggest trades to rebalance
- [X] **Interest & dividend income tracking** - record interest earned on savings accounts (taxable or exempt) and dividends received on investment accounts as discrete income events, separate from balance snapshots; display as income in analytics
- [X] **Flexible account tax treatment** - each investment account gets a user-defined tax status (tax-exempt like PEA/ISA/Roth IRA, tax-deferred like PER/401k, or fully taxable); latent tax calculation uses the account's own status instead of a global type - makes the app correct for non-French users who have no PEA equivalent
- [x] **Annual tax report** - yearly fiscal summary: realised gains, dividend income, taxable events; designed to be country-agnostic (exportable data) with a French IFU-ready view as a first implementation
- [ ] **Multi-currency** - hold positions in USD, GBP, CHF and display everything converted to the reference currency (EUR)

---

## v1.5 - Security & sharing

*Hardening the built-in auth and enabling controlled access for advisors or family.*

- [ ] **2FA (TOTP)** - two-factor authentication for the built-in credentials provider (`AUTH_ENABLED=true`)
- [ ] **Read-only share link** - generate a token-protected view-only URL to share the dashboard with an advisor or spouse without giving write access
- [ ] **Alerts & webhooks** - notify via Telegram, ntfy, or email when net worth crosses a threshold, a loan is nearly paid off, or a sync fails

---

## v1.6 - Integrations & platform

*Broader bank coverage, automation hooks, and better mobile experience.*

- [ ] **More broker integrations** - Degiro, Interactive Brokers, Boursorama, Binance via Woob or direct API (demand-driven)
- [ ] **GoCardless webhooks** - real-time balance updates instead of polling every 4 hours
- [ ] **Public REST API** - read-only API endpoints for external tools (Home Assistant, custom dashboards, mobile widgets)
- [ ] **PWA / mobile-optimised** - installable progressive web app with swipe-friendly views for phones
- [ ] **Light theme** - optional light colour scheme (currently dark only)
- [ ] **Plaid integration** - US and Canadian banks (only if there is clear community demand)

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
