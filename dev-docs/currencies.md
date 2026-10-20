# Currencies

Design for the ROADMAP's "configurable base currency" item, and what shipped of it.

## The problem, measured

Everything is stored and shown in EUR: every `*Cents` column, `formatCurrency` (hard-wired to `fr-FR`/`EUR`, 177 call sites), the history charts, the tax presets. Two kinds of users are shut out by that, and they need different things:

1. **A euro user with an account in another currency** (a USD Wise/Revolut balance, a CHF account). Today a Woob-synced USD account is stored *as if it were EUR* - `to_cents(account.balance)` ignores `account.currency` - so its 1 000 $ counts as 1 000 € in net worth, silently. Manual accounts cannot be entered in another currency at all. Only holdings can (`Holding.fxRateToEur`, see `investments-and-tax.md`, "Multi-currency").
2. **A non-euro user** (base currency USD, GBP, CHF...). Every figure on every page is in the wrong unit.

(2) needs (1) first: a USD-based user still has the odd EUR account, so "accounts in a currency other than the base" is the foundation either way. Hence two steps.

## Step 1 - accounts in another currency (base stays EUR)

**Store the base value where it already lives, the native value beside it.** The pattern `Holding` already uses: `HistoricalBalance.balanceCents` and `Transaction.amountCents` keep meaning "EUR cents", so the ~65 files that read them (net worth, analytics, budgets, alerts, exports, charts) do not change. New nullable columns carry what the bank or the user actually said:

| Column | Meaning |
|---|---|
| `Account.currency` | ISO 4217 code, `"EUR"` by default. A string, not the `HoldingCurrency` enum: Woob reports whatever the bank holds |
| `HistoricalBalance.nativeBalanceCents`, `.fxRate` | the balance in `Account.currency`, and the EUR per unit used to derive `balanceCents`. Both null for an EUR account |
| `Transaction.nativeAmountCents`, `.fxRate` | same, per transaction |
| `ExchangeRate(base, currency, day, rate)` | daily rates, shared by the app and the sync service; `base` is in the key so step 2 does not have to invalidate the table |

**Conversion happens at write time, at the rate of the moment the value describes.** A balance snapshot converts at the rate of its own time, so the history chart of a USD account shows what it was worth in EUR *then* - correct by construction, with no rate lookup on read. A transaction converts at its date's rate (CSV import of last year's statement included). The cost is that a balance nobody touches goes stale as rates move; the 4h snapshot cron revalues non-EUR accounts whose base value changed (step 1c).

**Traps found while designing, each a rule:**

- **Dedup must key on the native amount.** `composite_sync_id` and `_absorbed_by_nearby` (`sync/db.py`) identify an id-less transaction by its amount. Keyed on the converted amount, every rate move between two syncs would mint a new id and duplicate the whole history.
- **"Only insert a balance when it changed" compares native values.** `record_balance` skips a row equal to the last one; comparing EUR values would write a row on every sync for an unchanged USD balance (the rate moved), and comparing nothing would never revalue. Native unchanged + same day = skip; revaluation is the cron's job, once.
- **No silent fallback rate.** As for holdings: if no rate can be had, the write fails visibly (app) or the account is skipped with a logged error (sync). A wrong rate is worse than a missing sync.
- **Changing an account's currency is refused once it has history** - every stored conversion would be wrong. Delete and recreate, or (later) a "re-denominate" tool.
- **Manual movements shift native balances** (`recordManualMovement` moves every later snapshot by the movement's amount): on a non-EUR account that shift is applied to `nativeBalanceCents` and each row's `balanceCents` is recomputed with that row's own `fxRate`.

**Rates.** Yahoo's `EUR{XXX}=X` pair, already used for holdings, inverted (Yahoo quotes "XXX per 1 EUR"); the chart endpoint returns daily closes, so one request fills a date range for CSV imports. Cached per day in `ExchangeRate`, by both sides (`lib/services/exchange-rate.ts`, `sync/fx.py`). A day without a close (weekend, holiday) takes the last earlier one.

**Step 1 in three shippable parts:**

- **1a - rates and manual accounts.** `ExchangeRate` + the columns; currency picker on account creation (cash-like types: checking, savings, meal voucher); `setManualBalance` / `recordManualMovement` / `deleteManualEntry` in the native currency; native figures on the account page ("1 000,00 $US · ≈ 920,13 €").
- **1b - synced accounts.** Woob passes `account.currency`; GoCardless passes `balanceAmount.currency`/`transactionAmount.currency`; dedup keys on native amounts. Trade Republic and LCL are EUR-only and unchanged.
- **1c - imports and revaluation.** CSV balance/transaction imports at each row's date rate; the snapshot cron revalues.

## Step 2 - base currency (later)

Per **instance**, not per user: a co-owned account has one stored base value, and two co-owners with different bases cannot share it. Chosen at install (`BASE_CURRENCY`, default EUR); changing it with data in place is a script that reconverts history from `ExchangeRate`, not a setting. Then: `formatCurrency` takes the base from a module-level value set server-side from the env and client-side by a provider in the root layout (no `NEXT_PUBLIC_` - the Docker image is prebuilt); the literal "€" in labels and placeholders goes; `Holding.fxRateToEur` generalises to "to base"; tax presets are unaffected (they are about the country, not the unit). Discretion's scrambler already handles any symbol position and `,`/`.` separators.

## Shipped

**v2.18 - 1a and 1c: manual accounts in another currency.** Checking and savings accounts take a currency at creation (`ACCOUNT_CURRENCIES`, `parseAccountCurrency`); the initial balance, `setManualBalance`, `recordManualMovement`, `deleteManualEntry` and both CSV imports work in it and store the EUR value beside it (`balanceColumns`/`amountColumns`, `lib/domain/currency.ts`). Rates: `ratesToEurForDays` / `rateToEurOn` (`lib/services/exchange-rate.ts`) - one cache read and at most one Yahoo request per batch, a weekend day stored under its own key once filled. The 4h cron (`/api/investments/snapshot-balances`) revalues manual foreign accounts (`revaluation`: at most one row a day, at noon UTC). Displayed natively on the account page (header, transactions, manual-entry labels) and under the EUR value on the accounts list; everywhere else - dashboard, budgets, ledger, analytics, exports' figures - sees EUR, unchanged. The my-data export carries `currency` and every native column.

- **Found in the browser, fixed for every account:** the initial balance was stamped with the creation instant while manual entries land at noon UTC, so on an account created in the afternoon a spend typed for the same day had "no balance before it" and was refused. `createAccount` now stamps noon UTC too.
- Split amounts and "mark as income" stay in EUR on a foreign account (they feed budgets and income, which are EUR).
- The discretion guard (`__tests__/discretion.test.ts`) covers `formatMoney` as well as `formatCurrency`.
- Verified on a seeded instance: a 1 000 $ account shows "1 000 $US · ≈ 891 €" and moves net worth by 891 €; a 100 $ spend gives "900 $US · ≈ 802 €", a "-100,00 $US" row stored as -8 907 EUR cents with its rate; `ExchangeRate` holds a row per day; discretion scrambles the dollar figures; no console error.

**Not yet: 1b, synced accounts.** A Woob account in another currency is still stored as if it were EUR.
