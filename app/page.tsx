export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db/prisma";
import { getViewContext } from "@/lib/auth-context";
import { localeToIntl } from "@/lib/utils/format";
import { type AllocationSlice } from "@/components/shared/asset-allocation-chart";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { computeDashboard } from "@/lib/domain/dashboard";
import { ALLOCATION_CATEGORY_COLORS } from "@/lib/utils/palette";
import { getTranslations, getLocale } from "next-intl/server";
import { upcomingOccurrences } from "@/lib/domain/upcoming";
import { UpcomingCard } from "@/components/dashboard/upcoming-card";
import { cookies } from "next/headers";
import { FirstRunChecklist } from "@/components/dashboard/first-run-checklist";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { FIRST_RUN_COOKIE, checklistVariant, firstRunSteps } from "@/lib/domain/first-run";
import { loadFirstRunFacts } from "@/lib/services/first-run";

export default async function DashboardPage() {
  // Every query on this page is scoped to the accounts this viewer may see
  // (their own plus co-owned ones). In mono mode that resolves to the
  // instance owner, i.e. everything - identical to pre-v2.0 behavior.
  const { viewer, accountIds, readOnly } = await getViewContext();

  const [accounts, allBalances, t, locale] = await Promise.all([
    prisma.account.findMany({
      where: { id: { in: accountIds } },
      include: {
        institution: true,
        holdings: true,
        history: { orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 1 },
      },
      orderBy: { name: "asc" },
    }),
    prisma.historicalBalance.findMany({
      where: { accountId: { in: accountIds } },
      orderBy: { recordedAt: "asc" },
    }),
    getTranslations(),
    getLocale(),
  ]);
  const series = await prisma.recurringTransaction.findMany({
    where: { accountId: { in: accountIds }, active: true, dismissedAt: null },
    select: { id: true, label: true, amountCents: true, amountVaries: true, frequency: true, intervalCount: true, anchorDate: true },
  });
  const upcoming = upcomingOccurrences(series, new Date());


  const {
    hasAccounts,
    netWorth,
    grossAssets,
    totalPassif,
    totalLiabilities,
    totalLatentTax,
    allocationRaw,
    institutions,
    history,
    allocationHistory,
    delta30,
  } = computeDashboard({ accounts, allBalances, intlLocale: localeToIntl(locale), now: new Date() });

  // Not grossAssets > 0 - a LOAN-only portfolio has real data (a mortgage,
  // real payments) but zero gross assets by design (pure liability, no
  // asset counterpart, see lib/dashboard.ts). Gating on grossAssets showed
  // the "add your first account" empty state to a user who'd already added
  // one.
  const hasData = hasAccounts;

  // First-run checklist (v2.17): the viewer's own setup only, never on a
  // granted portfolio. With no account it replaces the empty dashboard;
  // otherwise it sits on top until done or hidden on this device.
  const steps = readOnly ? null : firstRunSteps(await loadFirstRunFacts(viewer.id, accountIds));
  const variant = checklistVariant(steps, hasAccounts, (await cookies()).get(FIRST_RUN_COOKIE)?.value === "1");

  const allocationSlices: AllocationSlice[] = [
    { name: t("allocation.cash"), value: allocationRaw.cash, color: ALLOCATION_CATEGORY_COLORS.cash },
    { name: t("allocation.savings"), value: allocationRaw.savings, color: ALLOCATION_CATEGORY_COLORS.savings },
    { name: t("allocation.investments"), value: allocationRaw.investments, color: ALLOCATION_CATEGORY_COLORS.investments },
    { name: t("allocation.crypto"), value: allocationRaw.crypto, color: ALLOCATION_CATEGORY_COLORS.crypto },
    { name: t("allocation.realEstate"), value: allocationRaw.realEstate, color: ALLOCATION_CATEGORY_COLORS.realEstate },
    { name: t("allocation.auto"), value: allocationRaw.auto, color: ALLOCATION_CATEGORY_COLORS.auto },
  ];

  return (
    <DashboardView
      t={t}
      netWorth={netWorth}
      grossAssets={grossAssets}
      totalPassif={totalPassif}
      totalLiabilities={totalLiabilities}
      totalLatentTax={totalLatentTax}
      delta30={delta30}
      hasData={hasData}
      history={history}
      allocationSlices={allocationSlices}
      allocationHistory={allocationHistory}
      institutions={institutions}
      upcoming={
        <>
          {variant === "compact" && steps && <FirstRunChecklist t={t} steps={steps} variant="compact" />}
          <UpcomingCard t={t} upcoming={upcoming} intlLocale={localeToIntl(locale)} />
        </>
      }
      empty={variant === "full" && steps ? <FirstRunChecklist t={t} steps={steps} variant="full" /> : <DashboardEmptyState />}
      // The per-account links into /accounts/[id] stay live for a granted
      // portfolio - that page is scoped by the same view context and renders
      // read-only too. interactive=false is for the anonymous /shared/[token]
      // route, which must not expose them at all.
      interactive
    />
  );
}
