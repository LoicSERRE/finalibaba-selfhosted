import { NextRequest, NextResponse } from "next/server";
import { isInternalRequest } from "@/lib/services/internal-auth";
import { prisma } from "@/lib/db/prisma";
import { baseAccountIds } from "@/lib/auth-context";
import type { UserSettingsModel } from "@/app/generated/prisma/models";
import { localeToIntl } from "@/lib/utils/format";
import { computeDashboard } from "@/lib/domain/dashboard";
import { calcCurrentCapital, hasLoanParams } from "@/lib/domain/loan";
import { evaluateNetWorthAlert, isLoanNearlyPaidOff } from "@/lib/domain/alerts";
import { dispatchAlert } from "@/lib/services/notifications";
import { checkSyncFailures, checkSectorDataHealth } from "@/lib/services/alerts/sync-failures";
import { checkCustomAlertRules } from "@/lib/services/alerts/custom-rules";

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
