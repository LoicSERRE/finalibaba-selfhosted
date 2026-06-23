# Roadmap — Finalibaba Self-Hosted

Planned features and improvements, roughly in priority order.

---

## v1.1 — Internationalisation + configurable tax rates

These two features are bundled into a single milestone: shipping i18n with hardcoded French tax rates would be useless for non-French users. Both share the same settings infrastructure.

- [ ] **English UI** — `next-intl` integration (`en` default, `fr` translation). No URL prefix per locale.
- [ ] **User-configurable tax rates** — PEA, CTO, and Crypto rates editable in Settings instead of hardcoded French defaults. Common presets: Germany (25%), UK (ISA 0%), Belgium (30%).

This milestone is community-triggered: it will be prioritised when there is clear demand from non-French users.

---

## Backlog

### Data & import

- [ ] **CSV import** — bulk import of transactions and balance history for accounts not covered by auto-sync
- [ ] **Historical net worth import** — import past balance snapshots (CSV/spreadsheet) to backfill the historical chart for new users migrating from Excel or Finary
- [ ] **Backup & restore** — one-command database export and full restore; critical for self-hosters before upgrades

### Investments & analytics

- [ ] **Benchmark comparison** — overlay portfolio CAGR against a reference index (MSCI World, S&P 500, CAC 40) on the analytics chart
- [ ] **Portfolio rebalancing** — define a target allocation per account, show current drift, suggest trades to rebalance
- [ ] **Annual tax report** — yearly fiscal summary for French tax declaration: realised gains, CTO/crypto taxable events, IFU-ready breakdown
- [ ] **Multi-currency** — hold positions in USD, GBP, CHF and display everything converted to the reference currency (EUR)

### Budgeting & cash-flow

- [ ] **Transaction categories & budgets** — categorize transactions (food, transport, housing…), set monthly budget envelopes per category, track spending vs budget
- [ ] **Recurring transactions** — flag subscriptions and regular income; project future cash flow and detect missed payments

### Sharing & notifications

- [ ] **Read-only share link** — generate a token-protected view-only URL to share the dashboard with an advisor or spouse without giving write access
- [ ] **Alerts & webhooks** — notify via Telegram, ntfy, or email when net worth crosses a threshold, a loan is nearly paid off, or a sync fails

### Auth & security

- [ ] **2FA (TOTP)** — two-factor authentication for the built-in credentials provider (`AUTH_ENABLED=true`)
- [ ] **Multi-user support** — independent portfolios for multiple users on the same instance

### Integrations

- [ ] **More broker integrations** — Degiro, Interactive Brokers, Boursorama, Binance via Woob or direct API (demand-driven)
- [ ] **GoCardless webhooks** — real-time balance updates instead of polling every 4 hours
- [ ] **Plaid integration** — US and Canadian banks (only if there is clear community demand)
- [ ] **Public REST API** — read-only API endpoints for external tools (Home Assistant, custom dashboards, mobile widgets)

### UX & platform

- [ ] **PWA / mobile-optimised** — installable progressive web app with swipe-friendly views for phones
- [ ] **Light theme** — optional light colour scheme (currently dark only)

---

## Completed

- [x] AGPL-3.0 open-source release
- [x] `docker compose up` one-command setup
- [x] All account types: checking/savings, PEA/CTO, crypto, real estate, automobile, loan, meal vouchers
- [x] Optional built-in password authentication (`AUTH_ENABLED=true`)
- [x] GoCardless PSD2 open banking — 2,200+ banks across EU and UK
- [x] Trade Republic auto-sync — 18 EU countries
- [x] LCL bank auto-sync (FR, via Woob)
- [x] Analytics: savings rate, runway, passive income, CAGR, sector allocation
- [x] CSV and PDF export
- [x] WCAG 2.1 accessibility (keyboard navigation, screen reader, focus management)
- [x] Demo mode — pre-seeded fictional data, read-only, auto-reset via cron
