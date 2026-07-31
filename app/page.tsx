export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db/prisma";
import { formatCurrency, localeToIntl } from "@/lib/utils/format";
import { NetWorthChart } from "@/components/shared/net-worth-chart";
import { AssetAllocationChart, type AllocationSlice } from "@/components/shared/asset-allocation-chart";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { InstitutionLogo } from "@/components/shared/institution-logo";
import Link from "next/link";
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
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">{t("dashboard.title")}</h1>
        <p className="text-sm text-[var(--muted)] mt-1">{t("dashboard.subtitle")}</p>
      </div>

      {/* Hero KPI */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 sm:p-8">
        <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-3">{t("dashboard.netWorth")}</p>
        <p className="text-4xl sm:text-5xl font-bold tabular-nums text-[var(--accent)] break-words leading-none">
          {formatCurrency(netWorth, 0)}
        </p>
        {delta30 && (
          <div className="mt-3 flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 text-sm font-medium tabular-nums ${
                delta30.amount >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"
              }`}
            >
              {delta30.amount >= 0 ? "▲" : "▼"}
              {formatCurrency(Math.abs(delta30.amount), 0)}
              {delta30.percent !== null && (
                <span className="font-normal opacity-80">
                  ({delta30.percent >= 0 ? "+" : ""}{delta30.percent.toFixed(1)}%)
                </span>
              )}
            </span>
            <span className="text-xs text-[var(--muted)]">{t("dashboard.last30d")}</span>
          </div>
        )}
        <div className="mt-5 pt-5 border-t border-[var(--border)] grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-1">{t("dashboard.gross")}</p>
            <p className="text-lg font-semibold tabular-nums text-[var(--foreground)]">
              {formatCurrency(grossAssets, 0)}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-1">{t("dashboard.liabilities")}</p>
            <p className="text-lg font-semibold tabular-nums text-[var(--negative)]">
              {formatCurrency(totalPassif, 0)}
            </p>
            {totalPassif > BigInt(0) && (
              <div className="mt-0.5 space-y-0.5">
                {totalLiabilities > BigInt(0) && (
                  <p className="text-xs text-[var(--muted)]">{t("dashboard.debts")} {formatCurrency(totalLiabilities, 0)}</p>
                )}
                {totalLatentTax > BigInt(0) && (
                  <p className="text-xs text-[var(--muted)]">{t("dashboard.latentTax")} {formatCurrency(totalLatentTax, 0)}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Charts */}
      {hasData && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="md:col-span-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
            <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-4">
              {t("dashboard.netWorthChart")}
            </h2>
            <NetWorthChart data={history} />
          </div>
          <div className="md:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
            <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-4">
              {t("dashboard.allocationChart")}
            </h2>
            <AssetAllocationChart data={allocationSlices} />
          </div>
        </div>
      )}

      {/* Accounts overview */}
      {hasData ? (
        <div className="space-y-3">
          <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
            {t("dashboard.myAccounts")}
          </h2>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
            {institutions.map((inst) => (
              <div key={inst.name ?? "__personal__"} className="px-6 py-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <InstitutionLogo name={inst.name ?? t("common.personal")} logoUrl={inst.logoUrl} size={28} />
                    <p className="text-sm font-semibold text-[var(--foreground)]">{inst.name ?? t("common.personal")}</p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-[var(--foreground)]">
                    {formatCurrency(inst.total, 0)}
                  </p>
                </div>
                <div className="space-y-0.5">
                  {inst.accounts.map((account) => (
                    <Link
                      key={account.id}
                      href={`/accounts/${account.id}`}
                      className="flex items-center justify-between text-xs group min-h-[44px] -mx-2 px-2 rounded-lg hover:bg-[var(--surface-elevated)] active:bg-[var(--border)] transition-colors"
                    >
                      <span className="text-[var(--muted)] group-hover:text-[var(--foreground)] transition-colors">
                        {account.name}
                      </span>
                      <span className="tabular-nums text-[var(--foreground)]">
                        {formatCurrency(account.value, 0)}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <DashboardEmptyState />
      )}
    </div>
  );
}
