import Link from "next/link";
import type { getTranslations } from "next-intl/server";
import { formatCurrency } from "@/lib/utils/format";
import { NetWorthChart } from "@/components/shared/net-worth-chart";
import { AssetAllocationChart, type AllocationSlice } from "@/components/shared/asset-allocation-chart";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { InstitutionLogo } from "@/components/shared/institution-logo";
import type { DashboardDelta, DashboardHistoryPoint, DashboardInstitutionGroup } from "@/lib/domain/dashboard";

type T = Awaited<ReturnType<typeof getTranslations>>;

/**
 * Pure presentational rendering shared by app/page.tsx (the real dashboard)
 * and app/shared/[token]/page.tsx (the read-only share link view) - both
 * compute the exact same lib/domain/dashboard.ts output, just from different
 * routes. `interactive=false` drops the only clickable element (the
 * per-account Link into /accounts/[id], a page the share-link route must
 * never lead to) in favor of a plain row.
 */
export function DashboardView({
  t,
  netWorth,
  grossAssets,
  totalPassif,
  totalLiabilities,
  totalLatentTax,
  delta30,
  hasData,
  history,
  allocationSlices,
  institutions,
  interactive = true,
}: Readonly<{
  t: T;
  netWorth: bigint;
  grossAssets: bigint;
  totalPassif: bigint;
  totalLiabilities: bigint;
  totalLatentTax: bigint;
  delta30: DashboardDelta | null;
  hasData: boolean;
  history: DashboardHistoryPoint[];
  allocationSlices: AllocationSlice[];
  institutions: DashboardInstitutionGroup[];
  interactive?: boolean;
}>) {
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
                  {inst.accounts.map((account) =>
                    interactive ? (
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
                    ) : (
                      <div
                        key={account.id}
                        className="flex items-center justify-between text-xs min-h-[44px] -mx-2 px-2"
                      >
                        <span className="text-[var(--muted)]">{account.name}</span>
                        <span className="tabular-nums text-[var(--foreground)]">
                          {formatCurrency(account.value, 0)}
                        </span>
                      </div>
                    )
                  )}
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
