import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import type { UserSettingsModel } from "@/app/generated/prisma/models";
import { localeToIntl } from "@/lib/utils/format";
import { computeDashboard } from "@/lib/domain/dashboard";
import { calcCurrentCapital, hasLoanParams } from "@/lib/domain/loan";
import {
  evaluateNetWorthAlert,
  isLoanNearlyPaidOff,
  evaluateAccountBalanceAlert,
  evaluateBudgetOverrunAlert,
  computeUnrealizedGain,
  evaluatePercentAlert,
  holdingMarketValueCents,
} from "@/lib/domain/alerts";
import { dispatchAlert } from "@/lib/services/notifications";
import { excludeInternalTransfers, excludeInternalTransfersOnSplit } from "@/lib/domain/transaction-filters";

/**
 * Called by sync/main.py at the end of every automatic 4h sync run (not on
 * demand-triggered "Sync now" clicks - see CLAUDE.md's "Alerts & webhooks"
 * for why). No browser session exists on that call path, so this route is
 * excluded from proxy.ts's NextAuth matcher (same category as api/auth) and
 * gates itself instead: NEXTAUTH_SECRET, already mandatory and already
 * maximally sensitive (session forgery), doubles as the shared bearer token
 * between the sync and app containers rather than requiring a new secret.
 */
function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  const expected = process.env.NEXTAUTH_SECRET;
  return !!expected && auth === `Bearer ${expected}`;
}

async function checkNetWorthAlert(settings: UserSettingsModel): Promise<boolean> {
  if (settings.netWorthAlertThresholdCents === null) return false;

  const [accounts, allBalances] = await Promise.all([
    prisma.account.findMany({
      include: {
        institution: true,
        holdings: true,
        history: { orderBy: { recordedAt: "desc" }, take: 1 },
      },
      orderBy: { name: "asc" },
    }),
    prisma.historicalBalance.findMany({ orderBy: { recordedAt: "asc" } }),
  ]);
  const { netWorth } = computeDashboard({
    accounts,
    allBalances,
    intlLocale: localeToIntl("fr"),
    now: new Date(),
  });

  const { shouldFire, isAbove } = evaluateNetWorthAlert(
    netWorth,
    settings.netWorthAlertThresholdCents,
    settings.netWorthAlertLastAbove
  );

  if (shouldFire) {
    const thresholdEuros = Number(settings.netWorthAlertThresholdCents) / 100;
    const netWorthEuros = Number(netWorth) / 100;
    await dispatchAlert(
      settings,
      isAbove ? "Patrimoine net : seuil dépassé" : "Patrimoine net : passé sous le seuil",
      `Ton patrimoine net est ${isAbove ? "passé au-dessus" : "passé en dessous"} de ${thresholdEuros.toLocaleString("fr-FR")} € (actuellement ${netWorthEuros.toLocaleString("fr-FR")} €).`
    );
  }

  if (isAbove !== settings.netWorthAlertLastAbove) {
    await prisma.userSettings.update({
      where: { id: "singleton" },
      data: { netWorthAlertLastAbove: isAbove },
    });
  }

  return shouldFire;
}

async function checkLoanAlerts(settings: UserSettingsModel): Promise<string[]> {
  if (!settings.loanAlertsEnabled) return [];

  const fired: string[] = [];
  const loanAccounts = await prisma.account.findMany({
    where: { type: "LOAN", loanPaidOffAlertSent: false },
  });

  for (const account of loanAccounts) {
    if (!hasLoanParams(account)) continue;
    const remaining = calcCurrentCapital({ ...account, loanDeferralMonths: account.loanDeferralMonths ?? 0 });
    if (!isLoanNearlyPaidOff(remaining, account.loanAmountCents)) continue;

    await dispatchAlert(
      settings,
      "Prêt bientôt remboursé",
      `Le prêt "${account.name}" est presque remboursé (${(Number(remaining) / 100).toLocaleString("fr-FR")} € restants).`
    );
    await prisma.account.update({
      where: { id: account.id },
      data: { loanPaidOffAlertSent: true },
    });
    fired.push(account.id);
  }

  return fired;
}

// SyncLog.source is a machine key ("trade_republic", "lcl", or
// "woob:<institutionId>" - the last one a raw cuid, never a name), kept
// that way because it's also SyncFailureState's unique dedup key and
// changing its shape would be a real migration risk. Resolved to something
// a human actually reads only here, at notification time - a real fix
// after a user found the raw ids in a push notification unreadable
// ("woob:cmqpvbok4000026lom282dpi4" told them nothing).
const FIXED_SOURCE_LABELS: Record<string, string> = {
  trade_republic: "Trade Republic",
  lcl: "LCL",
};

async function friendlySourceLabel(source: string): Promise<string> {
  if (FIXED_SOURCE_LABELS[source]) return FIXED_SOURCE_LABELS[source];
  if (source.startsWith("woob:")) {
    const institution = await prisma.institution.findUnique({
      where: { id: source.slice("woob:".length) },
      select: { name: true },
    });
    if (institution) return institution.name;
    // Real production case: the institution this SyncLog/SyncFailureState
    // row was created for has since been deleted (e.g. deleted and
    // recreated while troubleshooting a reconnect) - the raw source string
    // still carries its old id, and a user found that literal cuid ("woob:
    // cmqpvbok...") completely unreadable in a push notification. Same
    // "never surface raw internal identifiers to a human" rule this
    // function already exists to enforce for the FIXED_SOURCE_LABELS case
    // - the fallback below is generic instead of leaking the id, not a fix
    // for the underlying orphaned-row situation (which needs manual
    // cleanup in Settings, not a notification-formatting change).
    return "une banque configurée via Woob";
  }
  return source;
}

// Real production reports: sync-failure alerts kept firing forever for a
// source that could never recover, either because (a) LCL_LOGIN/TR_PHONE
// had been removed from .env (a deliberate, documented migration path off
// the dedicated sync - see CLAUDE.md's "Migrating an existing dedicated
// integration to Woob") so sync_lcl.py/sync_tr.py simply stop running and
// never write a fresh "success" SyncLog row that would ever clear the
// SyncFailureState, or (b) a woob:<id> source's Institution row was deleted
// or had its Woob config cleared, same "nothing will ever write a success
// row again" dead end. Neither case means the source is currently *broken*
// - it means it's not running at all anymore, which this alert has no
// business treating as an ongoing failure. Checked once per source per
// run (env vars and a single Institution lookup are cheap) rather than
// only at alert-creation time, so a source retired *after* it already had
// an active SyncFailureState still gets cleaned up and stops reminding.
async function isSourceRetired(source: string): Promise<boolean> {
  if (source === "lcl") return !process.env.LCL_LOGIN;
  if (source === "trade_republic") return !process.env.TR_PHONE;
  if (source.startsWith("woob:")) {
    const institution = await prisma.institution.findUnique({
      where: { id: source.slice("woob:".length) },
      select: { woobModule: true },
    });
    return !institution?.woobModule;
  }
  return false;
}

// Deliberately does not surface the raw SyncLog.message - it's Python
// exception text aimed at someone running the sync container's CLI
// ("Session web absente - lance --setup", "Certicode Plus requis - lance
// --setup"), not a notification a phone should show. A user flagged this
// directly: alerts need to read as "sobre et claire", not a raw error log.
// The two states the app actually distinguishes (auth_required vs a plain
// sync error) are enough to say something clear and actionable; the exact
// technical detail is still in Paramètres → sync status / SyncLog for
// anyone who wants to dig further.
function formatSyncFailureBody(label: string, status: string): string {
  if (status === "auth_required") {
    return `La connexion à "${label}" a expiré. Reconnecte-toi depuis Paramètres.`;
  }
  return `La synchronisation de "${label}" a rencontré un problème. Vérifie les journaux de synchro si ça persiste.`;
}

const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Edge-triggered, not level-triggered: alerts once when a source transitions
 * into a broken streak (SyncFailureState row created), then at most one
 * reminder per REMINDER_INTERVAL_MS while it stays broken, and clears the
 * moment the source succeeds again so the next failure (if any) is treated
 * as a brand new streak. Replaces a version that alerted once per failed
 * SyncLog row regardless of whether it was already known-broken - confirmed
 * the hard way that sends hundreds of emails within minutes once a source
 * has been broken for a while (every automatic-cron and AutoSync-triggered
 * retry wrote its own row, all alerted on the first check after being
 * unblocked). See CLAUDE.md's "Alerts & webhooks" / SyncFailureState comment
 * in schema.prisma for the full incident writeup.
 */
// Shared by both "this source isn't broken (anymore or ever again)" exits
// below (retired, or a fresh success) - extracted for real duplication
// removal, not just to shave a point off checkSyncFailures's own cognitive
// complexity as a side effect.
async function clearSyncFailureState(source: string, hasState: boolean): Promise<void> {
  if (hasState) await prisma.syncFailureState.delete({ where: { source } });
}

async function checkSyncFailures(settings: UserSettingsModel): Promise<string[]> {
  if (!settings.syncFailureAlertsEnabled) return [];

  // Only ever looks at each source's single most recent SyncLog row - older
  // rows are irrelevant to "is it broken right now".
  const latestPerSource = await prisma.syncLog.groupBy({
    by: ["source"],
    _max: { createdAt: true },
  });

  const fired: string[] = [];

  for (const { source, _max } of latestPerSource) {
    if (!_max.createdAt) continue;
    const latest = await prisma.syncLog.findFirst({
      where: { source, createdAt: _max.createdAt },
      orderBy: { id: "desc" },
    });
    if (!latest) continue;

    const state = await prisma.syncFailureState.findUnique({ where: { source } });

    if (await isSourceRetired(source)) {
      await clearSyncFailureState(source, !!state);
      continue;
    }

    if (latest.status === "success") {
      await clearSyncFailureState(source, !!state);
      continue;
    }

    if (!state) {
      await prisma.syncFailureState.create({ data: { source } });
      const label = await friendlySourceLabel(source);
      await dispatchAlert(settings, "Échec de synchronisation", formatSyncFailureBody(label, latest.status));
      fired.push(source);
    } else if (Date.now() - state.lastAlertedAt.getTime() >= REMINDER_INTERVAL_MS) {
      await prisma.syncFailureState.update({ where: { source }, data: { lastAlertedAt: new Date() } });
      const label = await friendlySourceLabel(source);
      await dispatchAlert(
        settings,
        "Échec de synchronisation (toujours en cours)",
        formatSyncFailureBody(label, latest.status)
      );
      fired.push(source);
    }
  }

  return fired;
}

type CustomAlertRule = Awaited<ReturnType<typeof findActiveAlertRules>>[number];

function findActiveAlertRules() {
  return prisma.alertRule.findMany({
    where: { active: true },
    include: {
      account: {
        include: {
          history: { orderBy: { recordedAt: "desc" }, take: 1 },
          holdings: true,
        },
      },
      holding: { include: { account: true } },
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
    const base = `Le prix de "${rule.holding.ticker}" (${rule.holding.account.name}) est ${isAbove ? "passé au-dessus" : "passé en dessous"} de ${thresholdEuros.toLocaleString("fr-FR")} € (actuellement ${currentEuros.toLocaleString("fr-FR")} €).`;
    await dispatchAlert(settings, "Alerte prix d'une position", rule.message ? `${base}\n\n${rule.message}` : base);
  }
  if (isAbove !== rule.balanceLastAbove) {
    await prisma.alertRule.update({ where: { id: rule.id }, data: { balanceLastAbove: isAbove } });
  }

  return shouldFire ? `holding_price_rule:${rule.id}` : null;
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

// UNREALIZED_GAIN: accountId set = that account's own holdings; accountId
// null = every investment/crypto account combined (a second query, since
// findActiveAlertRules only preloads the rule's own account - see
// CLAUDE.md's "Custom alert rules" for why null accountId is this kind's
// only valid null-account case). gainUnit picks which of the two
// dispatch-and-dedup checkers above applies - a rule stores exactly one
// threshold field, never both, so only one branch is ever reachable per
// rule. Split into the two functions above (rather than inlined here) to
// stay under the sonarjs cognitive-complexity gate - both branches share
// the same "compute gain, evaluate, dispatch, dedup" shape but over a
// different unit, so folding them into one function double-counts that
// shape's branching twice over.
async function checkUnrealizedGainRule(rule: CustomAlertRule, settings: UserSettingsModel): Promise<string | null> {
  if (rule.gainUnit === null) return null;

  const holdings = rule.account
    ? rule.account.holdings
    : await prisma.holding.findMany({ where: { account: { type: { in: ["INVESTMENT", "CRYPTO"] } } } });
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
  monthRange: { start: Date; end: Date }
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
      where: excludeInternalTransfers({
        categoryId: rule.category.id,
        amountCents: { lt: BigInt(0) },
        date: { gte: monthRange.start, lt: monthRange.end },
      }),
      _sum: { amountCents: true },
    }),
    prisma.transactionSplit.aggregate({
      where: excludeInternalTransfersOnSplit(
        { categoryId: rule.category.id, amountCents: { lt: BigInt(0) } },
        { date: { gte: monthRange.start, lt: monthRange.end } },
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

// One dispatch function per rule, kept separate from checkCustomAlertRules
// below to stay under the sonarjs cognitive-complexity gate (see CLAUDE.md's
// pre-commit pipeline notes) - a single combined switch inlined into the
// Promise.all map already tripped it once before this kind count grew.
function dispatchAlertRuleCheck(
  rule: CustomAlertRule,
  settings: UserSettingsModel,
  period: string,
  monthRange: { start: Date; end: Date }
): Promise<string | null> {
  switch (rule.kind) {
    case "ACCOUNT_BALANCE":
    case "ACCOUNT_OVERDRAFT":
      return checkAccountBalanceRule(rule, settings);
    case "INVESTMENT_VALUE":
      return checkInvestmentValueRule(rule, settings);
    case "HOLDING_PRICE":
      return checkHoldingPriceRule(rule, settings);
    case "UNREALIZED_GAIN":
      return checkUnrealizedGainRule(rule, settings);
    case "BUDGET_OVERRUN":
      return checkBudgetOverrunRule(rule, settings, period, monthRange);
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
async function checkCustomAlertRules(settings: UserSettingsModel): Promise<string[]> {
  const rules = await findActiveAlertRules();
  if (rules.length === 0) return [];

  const now = new Date();
  const period = now.toISOString().slice(0, 7);
  const monthRange = {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };

  const results = await Promise.all(rules.map((rule) => dispatchAlertRuleCheck(rule, settings, period, monthRange)));

  return results.filter((id): id is string => id !== null);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await prisma.userSettings.upsert({
    where: { id: "singleton" },
    create: {},
    update: {},
  });

  const netWorthFired = await checkNetWorthAlert(settings);
  const loansFired = await checkLoanAlerts(settings);
  const syncFailuresFired = await checkSyncFailures(settings);
  const customRulesFired = await checkCustomAlertRules(settings);

  const fired = [
    ...(netWorthFired ? ["net_worth_threshold"] : []),
    ...loansFired.map((id) => `loan_nearly_paid_off:${id}`),
    ...syncFailuresFired.map((source) => `sync_failure:${source}`),
    ...customRulesFired,
  ];

  return NextResponse.json({ ok: true, fired });
}
