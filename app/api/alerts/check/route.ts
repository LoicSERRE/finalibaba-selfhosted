import { classifySyncSource, SYNC_STATUS_CAPTCHA_REQUIRED } from "@/lib/domain/sync-status";
import { NextRequest, NextResponse } from "next/server";
import { isInternalRequest } from "@/lib/services/internal-auth";
import { prisma } from "@/lib/db/prisma";
import { baseAccountIds } from "@/lib/auth-context";
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
  computeHoldingDriftPts,
  evaluateNewTransactionAlert,
} from "@/lib/domain/alerts";
import { dispatchAlert } from "@/lib/services/notifications";
import { probeYahooSectorHealth } from "@/lib/services/yahoo-finance";
import { excludeInternalTransfers, excludeFromBudgetTotals, excludeFromBudgetTotalsOnSplit } from "@/lib/domain/transaction-filters";
import { amountMagnitudeRanges, type AmountRange } from "@/lib/domain/transactions-ledger";
import {
  isPerUserTrSource,
  isRealtimeSource,
  sourceInstitutionId,
  SOURCE_LCL,
  SOURCE_TRADE_REPUBLIC,
} from "@/lib/domain/sync-sources";

/**
 * Called by sync/main.py at the end of every automatic 4h run, never on a
 * "Sync now" click. No browser session on that path, so this route is out of
 * proxy.ts's matcher and gates itself on a NEXTAUTH_SECRET bearer token.
 */

async function checkNetWorthAlert(settings: UserSettingsModel, accountIds: string[]): Promise<boolean> {
  if (settings.netWorthAlertThresholdCents === null) return false;

  const [accounts, allBalances] = await Promise.all([
    prisma.account.findMany({
      where: { id: { in: accountIds } },
      include: {
        institution: true,
        holdings: true,
        history: { orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 1 },
      },
      orderBy: { name: "asc" },
    }),
    prisma.historicalBalance.findMany({ where: { accountId: { in: accountIds } }, orderBy: { recordedAt: "asc" } }),
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
      where: { userId: settings.userId },
      data: { netWorthAlertLastAbove: isAbove },
    });
  }

  return shouldFire;
}

async function checkLoanAlerts(settings: UserSettingsModel, accountIds: string[]): Promise<string[]> {
  if (!settings.loanAlertsEnabled) return [];

  const fired: string[] = [];
  const loanAccounts = await prisma.account.findMany({
    where: { id: { in: accountIds }, type: "LOAN", loanPaidOffAlertSent: false },
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

// SyncLog.source stays a machine key - it is also SyncFailureState's dedup
// key - and is resolved to something readable only here, at notification time.
// A raw cuid in a push notification tells the user nothing.
const FIXED_SOURCE_LABELS: Record<string, string> = {
  trade_republic: "Trade Republic",
  lcl: "LCL",
  // Not a bank sync: the sector-data health probe reuses this machinery.
  yahoo_sector_data: "Données sectorielles Yahoo Finance",
};

type InstitutionLite = { id: string; name: string; woobModule: string | null; trPhone: string | null };

function friendlySourceLabel(source: string, institutions: Map<string, InstitutionLite>): string {
  if (FIXED_SOURCE_LABELS[source]) return FIXED_SOURCE_LABELS[source];
  // Through the shared parser, never a per-prefix branch: a `woob:`-only one
  // let per-user Trade Republic sources fall through and be announced by their
  // raw cuid.
  const institutionId = sourceInstitutionId(source);
  if (institutionId) {
    const institution = institutions.get(institutionId);
    if (institution) return institution.name;
    // The institution was deleted and the source string still carries its id.
    // Generic beats leaking the id; the orphaned row needs cleanup in Settings.
    return isPerUserTrSource(source) ? "Trade Republic" : "une banque configurée via Woob";
  }
  return source;
}

// A retired source never writes another success row, so nothing would ever
// clear its SyncFailureState and it reminds forever: .env credentials removed,
// or an Institution deleted / its config cleared. Checked every run, not only
// at alert-creation time, so one retired AFTER its state row exists is cleaned
// up too.
function isSourceRetired(source: string, institutions: Map<string, InstitutionLite>): boolean {
  if (source === SOURCE_LCL) return !process.env.LCL_LOGIN;
  if (source === SOURCE_TRADE_REPUBLIC) return !process.env.TR_PHONE;
  const institutionId = sourceInstitutionId(source);
  if (institutionId) {
    const institution = institutions.get(institutionId);
    // Retired once the institution is gone, or once the provider this source
    // belongs to has been cleared from it. Checking the matching provider
    // rather than Woob's alone matters: a per-user Trade Republic connection
    // that was removed used to keep reminding "still broken" every 24h with
    // no way to ever clear itself, the same dead end this function was
    // written for when LCL_LOGIN was removed from .env.
    if (!institution) return true;
    const isTradeRepublic = isPerUserTrSource(source) || isRealtimeSource(source);
    return isTradeRepublic ? !institution.trPhone : !institution.woobModule;
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
  if (status === SYNC_STATUS_CAPTCHA_REQUIRED) {
    // Says what to do AND why it will not stop happening, because this one
    // never resolves itself - see lib/domain/sync-status.ts. Sent once only.
    return `"${label}" demande un captcha : ouvre Paramètres et clique sur « Se connecter » pour le résoudre. La synchronisation automatique ne peut pas le faire à ta place.`;
  }
  if (status === "auth_required") {
    return `La connexion à "${label}" a expiré. Reconnecte-toi depuis Paramètres.`;
  }
  return `La synchronisation de "${label}" a rencontré un problème. Vérifie les journaux de synchro si ça persiste.`;
}

const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Edge-triggered, never level-triggered: one alert when a source enters a
 * broken streak, one reminder per REMINDER_INTERVAL_MS while it stays broken,
 * cleared on the next success. Alerting per failed SyncLog row instead sends
 * hundreds of emails in minutes once a source has been broken a while.
 */
async function clearSyncFailureState(userId: string, source: string, hasState: boolean): Promise<void> {
  if (hasState) await prisma.syncFailureState.delete({ where: { userId_source: { userId, source } } });
}

type SourceGroup = { source: string; _max: { createdAt: Date | null } };

/**
 * Everything checkSyncFailures's loop needs, in three queries instead of three
 * per source.
 *
 * It used to run a findFirst, a findUnique and (inside isSourceRetired) an
 * institution lookup for every source, sequentially, inside a route that
 * already loops per user - so the cost grew as users × sources. Extracted
 * rather than inlined because this file is already the one flagged as the next
 * to split, and because the loop that consumes this is quite complex enough on
 * its own.
 */
async function loadSyncFailureContext(userId: string, groups: SourceGroup[]) {
  const pairs = groups
    .filter((g) => g._max.createdAt)
    .map((g) => ({ source: g.source, createdAt: g._max.createdAt as Date }));

  const institutionIds = [
    ...new Set(pairs.map((p) => sourceInstitutionId(p.source)).filter((id): id is string => !!id)),
  ];

  const [logRows, stateRows, institutions] = await Promise.all([
    pairs.length
      ? prisma.syncLog.findMany({ where: { userId, OR: pairs }, orderBy: { id: "desc" } })
      : Promise.resolve([]),
    prisma.syncFailureState.findMany({ where: { userId } }),
    institutionIds.length
      ? prisma.institution.findMany({
          where: { id: { in: institutionIds } },
          select: { id: true, name: true, woobModule: true, trPhone: true },
        })
      : Promise.resolve([]),
  ]);

  // orderBy id desc above, so the first row seen for a source is the one the
  // per-source findFirst used to return.
  const latestBySource = new Map<string, (typeof logRows)[number]>();
  for (const row of logRows) if (!latestBySource.has(row.source)) latestBySource.set(row.source, row);

  return {
    latestBySource,
    stateBySource: new Map(stateRows.map((r) => [r.source, r])),
    institutionById: new Map(institutions.map((i) => [i.id, i])),
  };
}

async function checkSyncFailures(settings: UserSettingsModel): Promise<string[]> {
  if (!settings.syncFailureAlertsEnabled) return [];

  // Only ever looks at each source's single most recent SyncLog row - older
  // rows are irrelevant to "is it broken right now".
  // Scoped to this user's own sync sources (v2.0) - a Woob source belongs to
  // whoever owns the institution, and the env-driven lcl/trade_republic
  // sources belong to the owner, so one user's broken bank never alerts
  // another.
  const latestPerSource = await prisma.syncLog.groupBy({
    by: ["source"],
    where: { userId: settings.userId },
    _max: { createdAt: true },
  });

  const { latestBySource, stateBySource, institutionById } = await loadSyncFailureContext(
    settings.userId,
    latestPerSource,
  );

  const fired: string[] = [];

  for (const { source, _max } of latestPerSource) {
    if (!_max.createdAt) continue;
    // A real-time listener reports on the same Trade Republic session its
    // batch sync uses, so a dead session makes both fail - and only the batch
    // sync's alert names something the user recognises and can act on. The
    // listener's own copy arrived titled "trade_republic_realtime", which
    // names nothing. Its SyncLog rows stay, and stay visible in Settings;
    // the verdict below suppresses the duplicate notification, not the
    // diagnosis.
    const latest = latestBySource.get(source);
    if (!latest) continue;
    const state = stateBySource.get(source) ?? null;

    // Every reason to skip a source, in one decision rather than five guards
    // stacked in front of the alerting. See lib/domain/sync-status.ts for what
    // each verdict means and why; the two facts it cannot know for itself are
    // computed here and handed in.
    const verdict = classifySyncSource({
      status: latest.status,
      isRetired: isSourceRetired(source, institutionById),
      isRealtime: isRealtimeSource(source),
      hasState: !!state,
    });
    if (verdict === "silent") continue;
    if (verdict === "clear") {
      // Deletes a row an earlier version may already have created rather than
      // only skipping ahead: left behind, it would sit in the table forever
      // with nothing left to ever clear it.
      await clearSyncFailureState(settings.userId, source, !!state);
      continue;
    }

    if (!state) {
      await prisma.syncFailureState.create({ data: { userId: settings.userId, source } });
      const label = friendlySourceLabel(source, institutionById);
      await dispatchAlert(settings, "Échec de synchronisation", formatSyncFailureBody(label, latest.status));
      fired.push(source);
    } else if (Date.now() - state.lastAlertedAt.getTime() >= REMINDER_INTERVAL_MS) {
      await prisma.syncFailureState.update({
        where: { userId_source: { userId: settings.userId, source } },
        data: { lastAlertedAt: new Date() },
      });
      const label = friendlySourceLabel(source, institutionById);
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

const SECTOR_DATA_SOURCE = "yahoo_sector_data";

/**
 * Degradation alert for the sector-exposure chart's Yahoo crumb path. Same
 * edge-triggered shape as checkSyncFailures, but manages its own
 * SyncFailureState row under a reserved key - nothing writes a SyncLog row for
 * this JS-only concern, so that loop would never find it.
 *
 * Alerts on `!anyPathHealthy`, not `!yahooHealthy`: a working fallback means
 * the feature has not stopped working.
 */
async function checkSectorDataHealth(settings: UserSettingsModel): Promise<string[]> {
  if (!settings.sectorDataAlertsEnabled) return [];

  const { anyPathHealthy } = await probeYahooSectorHealth();
  // Yahoo's health is an instance-wide fact, but the dedup state is still
  // per-user: each user opted into this alert separately, so each gets their
  // own "already told you" bookkeeping rather than the first user's check
  // silencing everyone else's.
  const state = await prisma.syncFailureState.findUnique({
    where: { userId_source: { userId: settings.userId, source: SECTOR_DATA_SOURCE } },
  });

  if (anyPathHealthy) {
    await clearSyncFailureState(settings.userId, SECTOR_DATA_SOURCE, !!state);
    return [];
  }

  const body =
    "La récupération des données de répartition sectorielle (Analytique) depuis Yahoo Finance a échoué. " +
    "Configure une clé API de secours (FMP_API_KEY ou ALPHA_VANTAGE_API_KEY) pour plus de résilience.";

  if (!state) {
    await prisma.syncFailureState.create({ data: { userId: settings.userId, source: SECTOR_DATA_SOURCE } });
    await dispatchAlert(settings, "Données sectorielles indisponibles", body);
    return [SECTOR_DATA_SOURCE];
  }
  if (Date.now() - state.lastAlertedAt.getTime() >= REMINDER_INTERVAL_MS) {
    await prisma.syncFailureState.update({
      where: { userId_source: { userId: settings.userId, source: SECTOR_DATA_SOURCE } },
      data: { lastAlertedAt: new Date() },
    });
    await dispatchAlert(settings, "Données sectorielles indisponibles (toujours en cours)", body);
    return [SECTOR_DATA_SOURCE];
  }
  return [];
}

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
async function checkCustomAlertRules(settings: UserSettingsModel, accountIds: string[]): Promise<string[]> {
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

export async function POST(req: NextRequest) {
  if (!isInternalRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // One evaluation pass per user (v2.0). Everything this route reads is
  // per-user now - the thresholds and channel config on UserSettings, the
  // AlertRule rows, the (userId, source) sync-failure dedup state - and
  // every figure it computes has to come from that user's own accounts, or
  // an alert would quote a net worth its recipient can't see anywhere in
  // their own app. In mono mode this loops exactly once, over the owner.
  //
  // baseAccountIds (own + co-owned), never viewAccountIds: a portfolio
  // merely granted to someone for reading must not start generating alerts
  // in their name, and must stop being visible the moment it's revoked -
  // which a notification already sent never could.
  const users = await prisma.user.findMany({ select: { id: true } });
  const fired: string[] = [];

  for (const user of users) {
    const [settings, accountIds] = await Promise.all([
      prisma.userSettings.upsert({
        where: { userId: user.id },
        create: { userId: user.id },
        update: {},
      }),
      baseAccountIds(user.id),
    ]);

    const netWorthFired = await checkNetWorthAlert(settings, accountIds);
    const loansFired = await checkLoanAlerts(settings, accountIds);
    const syncFailuresFired = await checkSyncFailures(settings);
    const sectorDataFired = await checkSectorDataHealth(settings);
    const customRulesFired = await checkCustomAlertRules(settings, accountIds);

    fired.push(
      ...(netWorthFired ? ["net_worth_threshold"] : []),
      ...loansFired.map((id) => `loan_nearly_paid_off:${id}`),
      ...syncFailuresFired.map((source) => `sync_failure:${source}`),
      ...sectorDataFired.map((source) => `sync_failure:${source}`),
      ...customRulesFired,
    );
  }

  return NextResponse.json({ ok: true, fired });
}
