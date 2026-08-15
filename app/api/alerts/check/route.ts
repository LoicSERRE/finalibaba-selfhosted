import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import type { UserSettingsModel } from "@/app/generated/prisma/models";
import { localeToIntl } from "@/lib/utils/format";
import { computeDashboard } from "@/lib/domain/dashboard";
import { calcCurrentCapital, hasLoanParams } from "@/lib/domain/loan";
import { evaluateNetWorthAlert, isLoanNearlyPaidOff } from "@/lib/domain/alerts";
import { dispatchAlert } from "@/lib/services/notifications";

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

function formatSyncFailureBody(source: string, message: string | null): string {
  const suffix = message ? ` : ${message}` : ".";
  return `La synchronisation "${source}" a échoué${suffix}`;
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

    if (latest.status === "success") {
      if (state) await prisma.syncFailureState.delete({ where: { source } });
      continue;
    }

    if (!state) {
      await prisma.syncFailureState.create({ data: { source } });
      await dispatchAlert(settings, "Échec de synchronisation", formatSyncFailureBody(source, latest.message));
      fired.push(source);
    } else if (Date.now() - state.lastAlertedAt.getTime() >= REMINDER_INTERVAL_MS) {
      await prisma.syncFailureState.update({ where: { source }, data: { lastAlertedAt: new Date() } });
      await dispatchAlert(
        settings,
        "Échec de synchronisation (toujours en cours)",
        formatSyncFailureBody(source, latest.message)
      );
      fired.push(source);
    }
  }

  return fired;
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

  const fired = [
    ...(netWorthFired ? ["net_worth_threshold"] : []),
    ...loansFired.map((id) => `loan_nearly_paid_off:${id}`),
    ...syncFailuresFired.map((source) => `sync_failure:${source}`),
  ];

  return NextResponse.json({ ok: true, fired });
}
