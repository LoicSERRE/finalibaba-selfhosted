/**
 * The eight user-defined `AlertRule` kinds and their per-kind checkers, split
 * out of app/api/alerts/check/route.ts at v2.10.2. See that route for the four
 * built-in triggers these run alongside. Text moved, nothing else.
 */
import { prisma } from "@/lib/db/prisma";
import type { UserSettingsModel } from "@/app/generated/prisma/models";
import {
  evaluateAccountBalanceAlert,
  evaluateBudgetOverrunAlert,
  computeUnrealizedGain,
  evaluatePercentAlert,
  holdingMarketValueCents,
  computeHoldingDriftPts,
  evaluateNewTransactionAlert,
} from "@/lib/domain/alerts";
import { dispatchAlert } from "@/lib/services/notifications";
import {
  excludeInternalTransfers,
  excludeFromBudgetTotals,
  excludeFromBudgetTotalsOnSplit,
} from "@/lib/domain/transaction-filters";
import { amountMagnitudeRanges, type AmountRange } from "@/lib/domain/transactions-ledger";

type CustomAlertRule = Awaited<ReturnType<typeof findActiveAlertRules>>[number];

function findActiveAlertRules(userId: string) {
  return prisma.alertRule.findMany({
    where: { userId, active: true },
    include: {
      account: {
        include: {
          history: { orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 1 },
          holdings: true,
        },
      },
      // account.holdings (not just account itself) - REBALANCING_DRIFT needs
      // every holding in the account to compute this position's own %
      // weight (see computeHoldingDriftPts), not just its own market value.
      holding: { include: { account: { include: { holdings: true } } } },
      category: true,
    },
  });
}

// Message text differs between ACCOUNT_BALANCE and ACCOUNT_OVERDRAFT, kept
// out of checkAccountBalanceRule below (a nested ternary there tripped both
// sonarjs/no-nested-conditional and its own cognitive-complexity budget).
function buildAccountBalanceAlert(
  rule: CustomAlertRule,
  isAbove: boolean,
  currentEuros: number
): { title: string; base: string } {
  if (rule.kind === "ACCOUNT_OVERDRAFT") {
    const state = isAbove ? "repassé au-dessus de 0 €" : "passé à découvert";
    return {
      title: "Alerte découvert",
      base: `Le compte "${rule.account!.name}" est ${state} (actuellement ${currentEuros.toLocaleString("fr-FR")} €).`,
    };
  }
  const direction = isAbove ? "passé au-dessus" : "passé en dessous";
  const thresholdEuros = Number(rule.balanceThresholdCents) / 100;
  return {
    title: "Alerte solde de compte",
    base: `Le solde de "${rule.account!.name}" est ${direction} de ${thresholdEuros.toLocaleString("fr-FR")} € (actuellement ${currentEuros.toLocaleString("fr-FR")} €).`,
  };
}

// ACCOUNT_BALANCE and ACCOUNT_OVERDRAFT share this checker - both are the
// exact same "fiat account balance crosses balanceThresholdCents"
// edge-triggered comparison (evaluateAccountBalanceAlert), mirroring
// checkNetWorthAlert but kept as its own code path so the built-in
// net-worth trigger stays untouched. ACCOUNT_OVERDRAFT differs only in
// eligible-account scope (enforced client-side/in the create action, not
// here) and threshold (always 0, set at creation, never user-edited) - see
// createAlertRule in lib/actions/alert-rules.ts.
async function checkAccountBalanceRule(rule: CustomAlertRule, settings: UserSettingsModel): Promise<string | null> {
  if (!rule.account || rule.balanceThresholdCents === null) return null; // malformed row guard

  const current = rule.account.history[0]?.balanceCents ?? BigInt(0);
  const { shouldFire, isAbove } = evaluateAccountBalanceAlert(current, rule.balanceThresholdCents, rule.balanceLastAbove);

  if (shouldFire) {
    const { title, base } = buildAccountBalanceAlert(rule, isAbove, Number(current) / 100);
    await dispatchAlert(settings, title, rule.message ? `${base}\n\n${rule.message}` : base);
  }
  if (isAbove !== rule.balanceLastAbove) {
    await prisma.alertRule.update({ where: { id: rule.id }, data: { balanceLastAbove: isAbove } });
  }

  const tag = rule.kind === "ACCOUNT_OVERDRAFT" ? "account_overdraft_rule" : "account_balance_rule";
  return shouldFire ? `${tag}:${rule.id}` : null;
}

// INVESTMENT_VALUE: same edge-triggered comparison as checkAccountBalanceRule
// above, but "current" is the account's holdings market value (no
// HistoricalBalance for investment/crypto accounts) instead of a fiat
// balance - see holdingMarketValueCents.
async function checkInvestmentValueRule(rule: CustomAlertRule, settings: UserSettingsModel): Promise<string | null> {
  if (!rule.account || rule.balanceThresholdCents === null) return null;

  const current = rule.account.holdings.reduce((sum, h) => sum + holdingMarketValueCents(h), BigInt(0));
  const { shouldFire, isAbove } = evaluateAccountBalanceAlert(current, rule.balanceThresholdCents, rule.balanceLastAbove);

  if (shouldFire) {
    const thresholdEuros = Number(rule.balanceThresholdCents) / 100;
    const currentEuros = Number(current) / 100;
    const base = `La valeur du compte "${rule.account.name}" est ${isAbove ? "passée au-dessus" : "passée en dessous"} de ${thresholdEuros.toLocaleString("fr-FR")} € (actuellement ${currentEuros.toLocaleString("fr-FR")} €).`;
    await dispatchAlert(settings, "Alerte valeur d'investissement", rule.message ? `${base}\n\n${rule.message}` : base);
  }
  if (isAbove !== rule.balanceLastAbove) {
    await prisma.alertRule.update({ where: { id: rule.id }, data: { balanceLastAbove: isAbove } });
  }

  return shouldFire ? `investment_value_rule:${rule.id}` : null;
}

// HOLDING_PRICE: same edge-triggered comparison again, over a single
// position's lastPriceCents (already EUR-converted at entry time for
// foreign-currency holdings, see Holding.fxRateToEur - no extra FX handling
// needed here).
async function checkHoldingPriceRule(rule: CustomAlertRule, settings: UserSettingsModel): Promise<string | null> {
  if (!rule.holding || rule.balanceThresholdCents === null) return null;

  const current = rule.holding.lastPriceCents;
  const { shouldFire, isAbove } = evaluateAccountBalanceAlert(current, rule.balanceThresholdCents, rule.balanceLastAbove);

  if (shouldFire) {
    const thresholdEuros = Number(rule.balanceThresholdCents) / 100;
    const currentEuros = Number(current) / 100;
    // name falls back to ticker (a real ISIN, see CLAUDE.md's "Automatic
    // categorization") only when no friendly name was ever set on the
    // holding - same `name ?? ticker` convention every other holding
    // display in this app already uses (holdings-table.tsx, investment-
    // tab.tsx, export-accounts-button.tsx). This one was missed when the
    // custom-alert-rules feature was built - a real report: the raw ISIN
    // was showing up in the actual dispatched ntfy/email notification
    // text, not just a display-only quirk.
    const holdingLabel = rule.holding.name ?? rule.holding.ticker;
    const base = `Le prix de "${holdingLabel}" (${rule.holding.account.name}) est ${isAbove ? "passé au-dessus" : "passé en dessous"} de ${thresholdEuros.toLocaleString("fr-FR")} € (actuellement ${currentEuros.toLocaleString("fr-FR")} €).`;
    await dispatchAlert(settings, "Alerte prix d'une position", rule.message ? `${base}\n\n${rule.message}` : base);
  }
  if (isAbove !== rule.balanceLastAbove) {
    await prisma.alertRule.update({ where: { id: rule.id }, data: { balanceLastAbove: isAbove } });
  }

  return shouldFire ? `holding_price_rule:${rule.id}` : null;
}

// REBALANCING_DRIFT: |driftPts| crosses gainThresholdPct, reusing
// evaluatePercentAlert's edge-triggered comparison (see its own comment for
// why REBALANCING_DRIFT is included there) fed the absolute drift, since
// both overweight and underweight count as "drifted" - fires once when
// newly past tolerance, once again when it comes back within tolerance.
async function checkRebalancingDriftRule(rule: CustomAlertRule, settings: UserSettingsModel): Promise<string | null> {
  if (!rule.holding || rule.gainThresholdPct === null) return null;

  const driftPts = computeHoldingDriftPts(rule.holding, rule.holding.account.holdings);
  if (driftPts === null) return null; // target cleared since the rule was created, or the account is empty

  const { shouldFire, isAbove } = evaluatePercentAlert(Math.abs(driftPts), rule.gainThresholdPct, rule.balanceLastAbove);

  if (shouldFire) {
    const holdingLabel = rule.holding.name ?? rule.holding.ticker;
    const accountName = rule.holding.account.name;
    // The over/under wording is pulled out rather than nested inside the
    // template literal: a ternary inside a ternary is exactly as hard to read
    // as it sounds, and this one decides the wording of a real notification.
    const direction = driftPts > 0 ? "surpondérée" : "sous-pondérée";
    const base = isAbove
      ? `La position "${holdingLabel}" (${accountName}) a dérivé de plus de ${rule.gainThresholdPct} points de sa cible (actuellement ${direction} de ${Math.abs(driftPts)} points).`
      : `La position "${holdingLabel}" (${accountName}) est revenue dans la tolérance de ${rule.gainThresholdPct} points par rapport à sa cible.`;
    await dispatchAlert(settings, "Alerte de dérive du portefeuille", rule.message ? `${base}\n\n${rule.message}` : base);
  }
  if (isAbove !== rule.balanceLastAbove) {
    await prisma.alertRule.update({ where: { id: rule.id }, data: { balanceLastAbove: isAbove } });
  }

  return shouldFire ? `rebalancing_drift_rule:${rule.id}` : null;
}

async function checkUnrealizedGainPercent(
  rule: CustomAlertRule,
  settings: UserSettingsModel,
  gainPct: number | null,
  scopeLabel: string
): Promise<string | null> {
  if (rule.gainThresholdPct === null || gainPct === null) return null;
  const { shouldFire, isAbove } = evaluatePercentAlert(gainPct, rule.gainThresholdPct, rule.balanceLastAbove);
  if (shouldFire) {
    const base = `La plus-value latente ${scopeLabel} est ${isAbove ? "passée au-dessus" : "passée en dessous"} de ${rule.gainThresholdPct.toLocaleString("fr-FR")} % (actuellement ${gainPct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %).`;
    await dispatchAlert(settings, "Alerte plus-value latente", rule.message ? `${base}\n\n${rule.message}` : base);
  }
  if (isAbove !== rule.balanceLastAbove) {
    await prisma.alertRule.update({ where: { id: rule.id }, data: { balanceLastAbove: isAbove } });
  }
  return shouldFire ? `unrealized_gain_rule:${rule.id}` : null;
}

async function checkUnrealizedGainAmount(
  rule: CustomAlertRule,
  settings: UserSettingsModel,
  gainCents: bigint,
  scopeLabel: string
): Promise<string | null> {
  if (rule.balanceThresholdCents === null) return null;
  const { shouldFire, isAbove } = evaluateAccountBalanceAlert(gainCents, rule.balanceThresholdCents, rule.balanceLastAbove);
  if (shouldFire) {
    const thresholdEuros = Number(rule.balanceThresholdCents) / 100;
    const gainEuros = Number(gainCents) / 100;
    const base = `La plus-value latente ${scopeLabel} est ${isAbove ? "passée au-dessus" : "passée en dessous"} de ${thresholdEuros.toLocaleString("fr-FR")} € (actuellement ${gainEuros.toLocaleString("fr-FR")} €).`;
    await dispatchAlert(settings, "Alerte plus-value latente", rule.message ? `${base}\n\n${rule.message}` : base);
  }
  if (isAbove !== rule.balanceLastAbove) {
    await prisma.alertRule.update({ where: { id: rule.id }, data: { balanceLastAbove: isAbove } });
  }
  return shouldFire ? `unrealized_gain_rule:${rule.id}` : null;
}

// UNREALIZED_GAIN: accountId set = that account's holdings; null = every
// investment/crypto account combined, which needs a second query. gainUnit
// picks the branch, and a rule stores exactly one threshold field, so only one
// is ever reachable.
async function checkUnrealizedGainRule(
  rule: CustomAlertRule,
  settings: UserSettingsModel,
  accountIds: string[],
): Promise<string | null> {
  if (rule.gainUnit === null) return null;

  // accountId null on this kind alone means "aggregate across my whole
  // portfolio" (not a malformed row) - which is the runner's own base
  // account set, never every INVESTMENT/CRYPTO holding in the instance.
  const holdings = rule.account
    ? rule.account.holdings
    : await prisma.holding.findMany({
        where: { accountId: { in: accountIds }, account: { type: { in: ["INVESTMENT", "CRYPTO"] } } },
      });
  const { gainCents, gainPct } = computeUnrealizedGain(holdings);
  const scopeLabel = rule.account ? `du compte "${rule.account.name}"` : "de l'ensemble du portefeuille";

  return rule.gainUnit === "PERCENT"
    ? checkUnrealizedGainPercent(rule, settings, gainPct, scopeLabel)
    : checkUnrealizedGainAmount(rule, settings, gainCents, scopeLabel);
}

// BUDGET_OVERRUN: re-arms every calendar month instead of edge-triggering -
// a category that overran its budget in July can alert again in August even
// though spend never "un-overran" in between, it just resets at the month
// boundary. See evaluateBudgetOverrunAlert.
async function checkBudgetOverrunRule(
  rule: CustomAlertRule,
  settings: UserSettingsModel,
  period: string,
  monthRange: { start: Date; end: Date },
  accountIds: string[],
): Promise<string | null> {
  if (rule.category?.budgetCents == null) return null;

  // isInternalTransfer: false and the split-portion sum both bring this in
  // line with how app/budgets/page.tsx itself computes a category's spend
  // (CLAUDE.md documents this as a standing invariant - "computed the same
  // way /budgets does") - two real gaps found while touching this function
  // for split-transaction support: this query never excluded internal
  // transfers at all (a manually-categorized one would count toward a
  // budget-overrun alert here but never toward the /budgets card for the
  // same category), and a split transaction's own categoryId is always
  // null so its portion of this category's spend would otherwise be
  // invisible to this alert entirely. See CLAUDE.md's "Split transactions".
  const [spend, splitSpend] = await Promise.all([
    prisma.transaction.aggregate({
      where: excludeFromBudgetTotals({
        accountId: { in: accountIds },
        categoryId: rule.category.id,
        amountCents: { lt: BigInt(0) },
        date: { gte: monthRange.start, lt: monthRange.end },
      }),
      _sum: { amountCents: true },
    }),
    prisma.transactionSplit.aggregate({
      where: excludeFromBudgetTotalsOnSplit(
        { categoryId: rule.category.id, amountCents: { lt: BigInt(0) } },
        { accountId: { in: accountIds }, date: { gte: monthRange.start, lt: monthRange.end } },
      ),
      _sum: { amountCents: true },
    }),
  ]);
  const spentCents = BigInt(0) - (spend._sum.amountCents ?? BigInt(0)) - (splitSpend._sum.amountCents ?? BigInt(0));
  const { shouldFire } = evaluateBudgetOverrunAlert(spentCents, rule.category.budgetCents, period, rule.budgetOverrunLastFiredPeriod);

  if (shouldFire) {
    const base = `Le budget de la catégorie "${rule.category.name}" est dépassé (${(Number(spentCents) / 100).toLocaleString("fr-FR")} € dépensés sur ${(Number(rule.category.budgetCents) / 100).toLocaleString("fr-FR")} € ce mois-ci).`;
    await dispatchAlert(settings, "Budget dépassé", rule.message ? `${base}\n\n${rule.message}` : base);
    await prisma.alertRule.update({ where: { id: rule.id }, data: { budgetOverrunLastFiredPeriod: period } });
    return `budget_overrun_rule:${rule.id}`;
  }
  return null;
}

// One Prisma key (amountCents) built from two independent rule fields, in one
// place - built separately they produce two amountCents objects and the spread
// silently drops one.
function buildNewTransactionAmountFilter(
  direction: "DEBIT" | "CREDIT" | null,
  minimumCents: bigint | null
): { amountCents?: { lt: bigint } | { gt: bigint } | { lte: bigint } | { gte: bigint }; OR?: { amountCents: AmountRange }[] } {
  if (direction === "DEBIT") {
    return { amountCents: minimumCents !== null ? { lte: -minimumCents } : { lt: BigInt(0) } };
  }
  if (direction === "CREDIT") {
    return { amountCents: minimumCents !== null ? { gte: minimumCents } : { gt: BigInt(0) } };
  }
  if (minimumCents !== null) {
    const ranges = amountMagnitudeRanges(minimumCents, null)?.map((range) => ({ amountCents: range }));
    return ranges ? { OR: ranges } : {};
  }
  return {};
}

const MAX_NEW_TRANSACTION_DIGEST = 20;

// NEW_TRANSACTION doesn't fit the threshold-crossing shape every kind above
// does - "a new transaction exists" isn't a value crossing a line, so it
// can't reuse balanceLastAbove's edge-trigger dedup. Uses its own cursor
// instead (AlertRule.lastNotifiedTransactionAt - see schema.prisma for the
// full reasoning). accountId reused as scope (null = every account, same
// "null is valid input" precedent as UNREALIZED_GAIN); balanceThresholdCents
// reused as a minimum absolute amount, not a crossing value. Internal
// transfers are unconditionally excluded, same as every other transaction
// query in this app - not a rule option.
async function checkNewTransactionRule(
  rule: CustomAlertRule,
  settings: UserSettingsModel,
  accountIds: string[],
): Promise<string | null> {
  const where = excludeInternalTransfers({
    // No accountId = every account the user has. A named one is still
    // INTERSECTED with that set rather than trusted - this is the one rule kind
    // that could otherwise quote another person's transactions in a
    // notification.
    accountId: rule.accountId
      ? { in: accountIds.filter((id) => id === rule.accountId) }
      : { in: accountIds },
    ...buildNewTransactionAmountFilter(rule.transactionDirection, rule.balanceThresholdCents),
  });

  // First-ever check: establish the cursor baseline without notifying, so
  // creating the rule against a long-synced account doesn't dump its entire
  // transaction history into one alert - same never-fire-on-first-check
  // convention as netWorthAlertLastAbove/balanceLastAbove.
  if (rule.lastNotifiedTransactionAt === null) {
    const latest = await prisma.transaction.findFirst({ where, orderBy: { createdAt: "desc" } });
    await prisma.alertRule.update({
      where: { id: rule.id },
      data: { lastNotifiedTransactionAt: latest?.createdAt ?? new Date() },
    });
    return null;
  }

  const sinceCursor = { ...where, createdAt: { gt: rule.lastNotifiedTransactionAt } };

  // The count and the newest timestamp come from ALL matching rows, not from
  // the page fetched for the digest. Advancing the cursor to the last row of a
  // capped page was silently lossy, and reliably so rather than rarely: a sync
  // writes its rows in one createMany, so a whole batch shares one createdAt,
  // and the next run's strictly-greater comparison then skipped every row past
  // the cap - permanently, with no error and nothing in the alert to suggest
  // anything was missing. Now the cursor moves past everything counted, and
  // the message says how many there were rather than how many fit.
  const totals = await prisma.transaction.aggregate({
    where: sinceCursor,
    _count: true,
    _max: { createdAt: true },
  });
  if (totals._count === 0 || totals._max.createdAt === null) return null;

  const newTransactions = await prisma.transaction.findMany({
    where: sinceCursor,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_NEW_TRANSACTION_DIGEST,
  });
  if (newTransactions.length === 0) return null;

  const { title, body } = evaluateNewTransactionAlert(newTransactions, totals._count);
  await dispatchAlert(settings, title, rule.message ? `${body}\n\n${rule.message}` : body);
  // Deliberately NOT resetting on a later threshold/direction edit, unlike
  // every threshold-crossing kind's own dedup flag - this cursor means
  // "already told the user about this transaction," which stays true
  // regardless of a later filter change.
  await prisma.alertRule.update({
    where: { id: rule.id },
    data: { lastNotifiedTransactionAt: totals._max.createdAt },
  });

  return `new_transaction_rule:${rule.id}`;
}

// One dispatch function per rule, kept separate from checkCustomAlertRules
// below to stay under the sonarjs cognitive-complexity gate (see CLAUDE.md's
// pre-commit pipeline notes) - a single combined switch inlined into the
// Promise.all map already tripped it once before this kind count grew.
function dispatchAlertRuleCheck(
  rule: CustomAlertRule,
  settings: UserSettingsModel,
  period: string,
  monthRange: { start: Date; end: Date },
  accountIds: string[],
): Promise<string | null> {
  switch (rule.kind) {
    case "ACCOUNT_BALANCE":
    case "ACCOUNT_OVERDRAFT":
      return checkAccountBalanceRule(rule, settings);
    case "INVESTMENT_VALUE":
      return checkInvestmentValueRule(rule, settings);
    case "HOLDING_PRICE":
      return checkHoldingPriceRule(rule, settings);
    case "REBALANCING_DRIFT":
      return checkRebalancingDriftRule(rule, settings);
    case "UNREALIZED_GAIN":
      return checkUnrealizedGainRule(rule, settings, accountIds);
    case "BUDGET_OVERRUN":
      return checkBudgetOverrunRule(rule, settings, period, monthRange, accountIds);
    case "NEW_TRANSACTION":
      return checkNewTransactionRule(rule, settings, accountIds);
    default:
      return Promise.resolve(null);
  }
}

/**
 * User-defined rules (Settings → "Règles d'alerte personnalisées"), a
 * parallel mechanism alongside the 3 fixed triggers above - see
 * CLAUDE.md's "Alerts & webhooks" and AlertRule in schema.prisma. Dispatches
 * each rule to its own per-kind checker via dispatchAlertRuleCheck above.
 */
export async function checkCustomAlertRules(settings: UserSettingsModel, accountIds: string[]): Promise<string[]> {
  const rules = await findActiveAlertRules(settings.userId);
  if (rules.length === 0) return [];

  const now = new Date();
  const period = now.toISOString().slice(0, 7);
  const monthRange = {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };

  const results = await Promise.all(
    rules.map((rule) => dispatchAlertRuleCheck(rule, settings, period, monthRange, accountIds))
  );

  return results.filter((id): id is string => id !== null);
}
