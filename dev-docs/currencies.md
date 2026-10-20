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

## Step 2 - base currency (v2.19)

**Per instance, not per user**: a co-owned account has one stored base value, and two co-owners with different bases cannot share it. Supported bases are `HoldingCurrency`'s four - EUR, USD, GBP, CHF - so that every holding's currency can be converted into any base; accounts still take any of the twelve `ACCOUNT_CURRENCIES`.

- **Settled once, stored, then authoritative.** `InstanceConfig` (one row) holds the base. `settleBaseCurrency` (`lib/services/instance-config.ts`), run from `instrumentation.ts` before the first request, stores it at the first boot under v2.19 - `BASE_CURRENCY` on a fresh install, **EUR on an instance that already has accounts** (`initialBaseCurrency`), since every figure stored before v2.19 is EUR and adopting another base over them would relabel them, not convert them - then sets `process.env.BASE_CURRENCY` to the stored value. A variable changed later is logged and ignored. Converting an instance is deliberately not offered: it would mean re-pricing every `*Cents` column of every model at historical rates, an operation to design on its own if anyone asks for it.
- **Read synchronously everywhere**: `baseCurrency()` (`lib/utils/base-currency.ts`) reads the environment on the server and `<html data-base-currency>` in the browser, which the root layout renders from the same value - so a server render and its hydration agree, and no `NEXT_PUBLIC_` variable is baked into the prebuilt image. `formatCurrency` and every chart's own formatter use it.
- **Unit labels**: the 28 "(€)" strings per locale get the base's symbol at load time (`withCurrencySymbol`, in `i18n/request.ts`) instead of 28 call sites; alert messages write `baseSymbol()` after their figures, unchanged for EUR.
- **Rates into the base**: Yahoo pairs are `{base}{currency}=X` on both sides, and `ExchangeRate` rows carry their base. Holdings convert to the base (`fetchExchangeRateToBase`; the column kept its `fxRateToEur` name and now means "to base"). The sync service reads the base from `InstanceConfig` (`sync/fx.py`'s `base_currency`, cached once found, `BASE_CURRENCY` then EUR before the app's first boot), and every account - app-created, GoCardless, Woob - is created in the base rather than the column's `'EUR'` default, so a bank reporting another currency re-denominates from the base.
- **Not changed**: amounts stay formatted with `fr-FR` number conventions (`1 234,56 $US`) whatever the UI language - making number formatting locale-aware is separate from the unit. Tax presets are about the country, not the currency.

## Shipped

**v2.18 - 1a and 1c: manual accounts in another currency.** Checking and savings accounts take a currency at creation (`ACCOUNT_CURRENCIES`, `parseAccountCurrency`); the initial balance, `setManualBalance`, `recordManualMovement`, `deleteManualEntry` and both CSV imports work in it and store the EUR value beside it (`balanceColumns`/`amountColumns`, `lib/domain/currency.ts`). Rates: `ratesToEurForDays` / `rateToEurOn` (`lib/services/exchange-rate.ts`) - one cache read and at most one Yahoo request per batch, a weekend day stored under its own key once filled. The 4h cron (`/api/investments/snapshot-balances`) revalues foreign accounts nothing else revalues (`revaluation`: at most one row a day, at noon UTC) - see 1b for which. Displayed natively on the account page (header, transactions, manual-entry labels) and under the EUR value on the accounts list; everywhere else - dashboard, budgets, ledger, analytics, exports' figures - sees EUR, unchanged. The my-data export carries `currency` and every native column.

- **Found in the browser, fixed for every account:** the initial balance was stamped with the creation instant while manual entries land at noon UTC, so on an account created in the afternoon a spend typed for the same day had "no balance before it" and was refused. `createAccount` now stamps noon UTC too.
- Split amounts and "mark as income" stay in EUR on a foreign account (they feed budgets and income, which are EUR).
- The discretion guard (`__tests__/discretion.test.ts`) covers `formatMoney` as well as `formatCurrency`.
- Verified on a seeded instance: a 1 000 $ account shows "1 000 $US · ≈ 891 €" and moves net worth by 891 €; a 100 $ spend gives "900 $US · ≈ 802 €", a "-100,00 $US" row stored as -8 907 EUR cents with its rate; `ExchangeRate` holds a row per day; discretion scrambles the dollar figures; no console error.

**v2.18 - 1b: synced accounts.** Woob (`account.currency`) and GoCardless (the account details' currency, else the balance's) store what the bank reports in its own currency, EUR beside it. Python reads and fills the same `ExchangeRate` table through `sync/fx.py` (`rates_for_days`, `to_base_cents` - half away from zero like decimal.js, pinned by shared vectors in `sync/tests/test_fx.py` and `__tests__/currency.test.ts`).

- **Dedup on the native amount** (`_absorbed_by_nearby` compares `COALESCE("nativeAmountCents", "amountCents")`; composite ids were already built from the bank's figure). `sync/tests/test_db_currency.py` fails if the window compares EUR again.
- **`record_balance` compares native figures**: unchanged dollars write nothing more the same day, and one row the next day if the rate moved them in EUR - a Woob account's revaluation is its own 4h sync. GoCardless accounts only sync on demand, so the 4h cron revalues them with the manual ones (`revalueForeignBalances` now covers every account without a `syncId`).
- **Re-denomination** of accounts synced before v2.18 (`resolve_account_currency` in `sync/db.py`, `resolveSyncedAccountCurrency` in `lib/services/account-currency.ts`): an account still EUR whose bank reports another currency has every stored figure taken as the native one and converted at its own day's rate, then switches - all rows or none, retried on the next sync if a day cannot be priced. A bank reporting nothing usable keeps the account's currency (`parse_currency` returns None, never EUR); a change between two foreign currencies is logged and skipped.
- A GoCardless transaction in another currency than its account (a card payment abroad, reported in the original currency by some banks) is skipped rather than mis-converted.
- No rate: Woob skips the account (balance and transactions) or the day's transactions; GoCardless skips the balance or the transaction. Nothing is stored at a guessed rate.
- **Still EUR-only:** Woob investment holdings (prices are stored as reported, as before), Trade Republic and LCL (EUR by nature).
