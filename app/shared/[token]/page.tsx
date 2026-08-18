export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { localeToIntl } from "@/lib/utils/format";
import { type AllocationSlice } from "@/components/shared/asset-allocation-chart";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { computeDashboard } from "@/lib/domain/dashboard";
import { isShareLinkExpired } from "@/lib/domain/share-links";
import { ALLOCATION_CATEGORY_COLORS } from "@/lib/utils/palette";
import { getTranslations, getLocale } from "next-intl/server";

// This URL may end up reachable from the public internet via a reverse
// proxy (that's the point - sharing outside the private network without
// turning AUTH_ENABLED on for the whole app) - keep it out of search indexes.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SharedDashboardPage({
  params,
}: Readonly<{
  params: Promise<{ token: string }>;
}>) {
  const { token } = await params;

  const link = await prisma.shareLink.findUnique({ where: { token } });

  // Same notFound() for "doesn't exist" and "expired" - no signal to an
  // anonymous visitor about which one it is.
  if (!link || isShareLinkExpired(link.expiresAt)) notFound();

  await prisma.shareLink.update({ where: { id: link.id }, data: { lastAccessedAt: new Date() } });

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
    delta30,
  } = computeDashboard({ accounts, allBalances, intlLocale: localeToIntl(locale), now: new Date() });

  const allocationSlices: AllocationSlice[] = [
    { name: t("allocation.cash"), value: allocationRaw.cash, color: ALLOCATION_CATEGORY_COLORS.cash },
    { name: t("allocation.savings"), value: allocationRaw.savings, color: ALLOCATION_CATEGORY_COLORS.savings },
    { name: t("allocation.investments"), value: allocationRaw.investments, color: ALLOCATION_CATEGORY_COLORS.investments },
    { name: t("allocation.crypto"), value: allocationRaw.crypto, color: ALLOCATION_CATEGORY_COLORS.crypto },
    { name: t("allocation.realEstate"), value: allocationRaw.realEstate, color: ALLOCATION_CATEGORY_COLORS.realEstate },
    { name: t("allocation.auto"), value: allocationRaw.auto, color: ALLOCATION_CATEGORY_COLORS.auto },
  ];

  return (
    <div className="max-w-4xl mx-auto pt-4">
      <div className="mb-6 flex items-center gap-2 text-xs text-[var(--muted)] bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2">
        <ShieldCheck size={14} className="text-[var(--positive)] shrink-0" aria-hidden="true" />
        <span>{link.label ? t("shared.readOnlyBannerLabeled", { label: link.label }) : t("shared.readOnlyBanner")}</span>
      </div>
      <DashboardView
        t={t}
        netWorth={netWorth}
        grossAssets={grossAssets}
        totalPassif={totalPassif}
        totalLiabilities={totalLiabilities}
        totalLatentTax={totalLatentTax}
        delta30={delta30}
        hasData={hasAccounts}
        history={history}
        allocationSlices={allocationSlices}
        institutions={institutions}
        interactive={false}
      />
    </div>
  );
}
