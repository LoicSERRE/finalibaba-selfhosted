# Roadmap — Finalibaba Self-Hosted

Current stable release: **v1.1.0**

Versions follow [Semantic Versioning](https://semver.org). Minor versions (1.x) are additive and backwards-compatible. v2.0 is a breaking architectural change (multi-user).

---

## v1.1.0 — Released ✓

- [x] **English & French UI** — `next-intl` integration, language auto-detected from browser (`Accept-Language`), manual switcher in Settings. No URL prefix per locale.
- [x] **User-configurable tax rates** — PEA, CTO, and Crypto rates editable in Settings.
- [x] **Mobile UX improvements** — WCAG-compliant touch targets (44×44px), responsive header layouts, icon-only buttons on narrow viewports.
- [x] **Auto-sync on app open** — sync triggered automatically when opening the app (all sources: LCL, Trade Republic, Woob institutions). Badge shown during sync.

---

## v1.2 — Data import & resilience

*The most-requested gap vs alternatives: getting data in without auto-sync, and keeping it safe.*

- [ ] **CSV import** — bulk import of transactions and balance history for accounts not covered by auto-sync
- [ ] **Historical net worth import** — import past balance snapshots (CSV/spreadsheet) to backfill the historical chart for users migrating from Excel or Finary
- [ ] **Backup & restore** — one-command database export and full restore; critical for self-hosters before upgrades

---

## v1.3 — Budgeting & cash-flow

*The main gap vs Firefly III: spending visibility and forward projection.*

- [ ] **Transaction categories & budgets** — categorize transactions (food, transport, housing…), set monthly budget envelopes per category, track spending vs budget
- [ ] **Recurring transactions** — flag subscriptions and regular income; project future cash flow and detect missed payments

---

## v1.4 — Advanced analytics

*Power features for investors: how does your portfolio compare, and what do you owe the taxman?*

- [ ] **Benchmark comparison** — overlay portfolio CAGR against a reference index (MSCI World, S&P 500, CAC 40)
- [ ] **Portfolio rebalancing** — define a target allocation per account, show current drift, suggest trades to rebalance
- [ ] **Annual tax report** — yearly fiscal summary for French tax declaration: realised gains, CTO/crypto taxable events, IFU-ready breakdown
- [ ] **Multi-currency** — hold positions in USD, GBP, CHF and display everything converted to the reference currency (EUR)

---

## v1.5 — Security & sharing

*Hardening the built-in auth and enabling controlled access for advisors or family.*

- [ ] **2FA (TOTP)** — two-factor authentication for the built-in credentials provider (`AUTH_ENABLED=true`)
- [ ] **Read-only share link** — generate a token-protected view-only URL to share the dashboard with an advisor or spouse without giving write access
- [ ] **Alerts & webhooks** — notify via Telegram, ntfy, or email when net worth crosses a threshold, a loan is nearly paid off, or a sync fails

---

## v1.6 — Integrations & platform

*Broader bank coverage, automation hooks, and better mobile experience.*

- [ ] **More broker integrations** — Degiro, Interactive Brokers, Boursorama, Binance via Woob or direct API (demand-driven)
- [ ] **GoCardless webhooks** — real-time balance updates instead of polling every 4 hours
- [ ] **Public REST API** — read-only API endpoints for external tools (Home Assistant, custom dashboards, mobile widgets)
- [ ] **PWA / mobile-optimised** — installable progressive web app with swipe-friendly views for phones
- [ ] **Light theme** — optional light colour scheme (currently dark only)
- [ ] **Plaid integration** — US and Canadian banks (only if there is clear community demand)

---

## v2.0 — Multi-user

*Breaking architectural change: all data gains user ownership, requiring a migration.*

- [ ] **Multi-user support** — independent portfolios for multiple users on the same instance; role-based access (owner / read-only guest)

---

## v1.0.0 — Released ✓

- [x] `docker compose up` one-command setup
- [x] All account types: checking/savings, PEA/CTO, crypto, real estate, automobile, loan, meal vouchers
- [x] Live prices via Yahoo Finance (stocks, ETFs, crypto)
- [x] French tax calculations — latent taxes: PEA 17.2%, CTO 31.4%, Crypto 31.4%
- [x] Analytics: savings rate, runway, passive income, CAGR, sector allocation, benchmark radar
- [x] Auto-sync: Trade Republic (18 EU countries), LCL via Woob, generic Woob for other FR banks
- [x] GoCardless PSD2 open banking — 2,200+ banks across EU and UK
- [x] Optional built-in password authentication (`AUTH_ENABLED=true`)
- [x] CSV and PDF export
- [x] Demo mode — pre-seeded fictional data, read-only (`DEMO_MODE=true`), cron reset
- [x] WCAG 2.1 accessibility (keyboard navigation, screen reader, focus management)
- [x] AGPL-3.0 open-source release
