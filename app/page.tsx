export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db/prisma";
import { localeToIntl } from "@/lib/utils/format";
import { type AllocationSlice } from "@/components/shared/asset-allocation-chart";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { computeDashboard } from "@/lib/domain/dashboard";
import { ALLOCATION_CATEGORY_COLORS } from "@/lib/utils/palette";
import { getTranslations, getLocale } from "next-intl/server";

export default async function DashboardPage() {
  const [accounts, allBalances, t, locale] = await Promise.all([
    prisma.account.findMany({
      include: {
        institution: true,
        holdings: true,
        history: { orderBy: { recordedAt: "desc" }, take: 1 },
      },
      orderBy: { name: "asc" },
    }),
    prisma.historicalBalance.findMany({ orderBy: { recordedAt: "asc" } }),
    getTranslations(),
    getLocale(),
  ]);

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
    />
  );
}
