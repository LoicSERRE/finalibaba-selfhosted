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

async function checkSyncFailures(settings: UserSettingsModel): Promise<string[]> {
  if (!settings.syncFailureAlertsEnabled) return [];

  const since = settings.lastSyncFailureAlertCheckedAt ?? new Date(0);
  const failures = await prisma.syncLog.findMany({
    where: { status: "error", createdAt: { gt: since } },
    orderBy: { createdAt: "asc" },
  });

  for (const failure of failures) {
    await dispatchAlert(settings, "Échec de synchronisation", formatSyncFailureBody(failure.source, failure.message));
  }

  if (failures.length > 0) {
    await prisma.userSettings.update({
      where: { id: "singleton" },
      data: { lastSyncFailureAlertCheckedAt: new Date() },
    });
  }

  return failures.map((f) => f.source);
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
