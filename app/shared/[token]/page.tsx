export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { baseAccountIds } from "@/lib/auth-context";
import { localeToIntl } from "@/lib/utils/format";
import { type AllocationSlice } from "@/components/shared/asset-allocation-chart";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { SharedHoldingsSection } from "@/components/shared/shared-holdings-section";
import { SharedTransactionsSection } from "@/components/shared/shared-transactions-section";
import { computeDashboard } from "@/lib/domain/dashboard";
import { isShareLinkExpired, buildSharedHoldings } from "@/lib/domain/share-links";
import { ALLOCATION_CATEGORY_COLORS } from "@/lib/utils/palette";
import { getTranslations, getLocale } from "next-intl/server";

// "Recent transactions" is a bounded window, not the account's full history
// - same reasoning as CSV import's duplicate-flagging scope, just applied to
// display instead of matching: a share link recipient (advisor/family) needs
// enough to see spending patterns, not a complete ledger export.
const MAX_SHARED_TRANSACTIONS = 20;

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

  // Strictly the LINK OWNER's own portfolio (their accounts + co-owned
  // ones) - baseAccountIds, never viewAccountIds. A read-only guest must not
  // be able to mint a public link over the portfolio someone merely shared
  // with them: such a link carries no grant check of its own and would keep
  // working after the grant was revoked. This query used to be entirely
  // unscoped, exposing every account in the instance to any token holder.
  const sharedAccountIds = await baseAccountIds(link.userId);

  const [accounts, allBalances, sharedTransactions, t, locale] = await Promise.all([
    prisma.account.findMany({
      where: { id: { in: sharedAccountIds } },
      include: {
        institution: true,
        holdings: true,
        history: { orderBy: { recordedAt: "desc" }, take: 1 },
      },
      orderBy: { name: "asc" },
    }),
    prisma.historicalBalance.findMany({ where: { accountId: { in: sharedAccountIds } }, orderBy: { recordedAt: "asc" } }),
    // Skip the query entirely when the link doesn't opt into it - no reason
    // to pull real transaction rows out of the DB for a link that will never
    // render them.
    link.includeTransactions
      ? prisma.transaction.findMany({
          where: { accountId: { in: sharedAccountIds }, isInternalTransfer: false },
          orderBy: { date: "desc" },
          take: MAX_SHARED_TRANSACTIONS,
          include: { category: { select: { name: true, color: true } }, account: { select: { name: true } } },
        })
      : Promise.resolve([]),
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
        allocationHistory={allocationHistory}
        institutions={institutions}
        interactive={false}
      />
      {link.includeHoldings && (
        <div className="mt-8">
          <SharedHoldingsSection t={t} groups={buildSharedHoldings(accounts)} />
        </div>
      )}
      {link.includeTransactions && (
        <div className="mt-8">
          <SharedTransactionsSection
            t={t}
            locale={localeToIntl(locale)}
            transactions={sharedTransactions.map((tx) => ({
              id: tx.id,
              date: tx.date,
              label: tx.label,
              amountCents: tx.amountCents,
              accountName: tx.account.name,
              category: tx.category,
            }))}
          />
        </div>
      )}
    </div>
  );
}
