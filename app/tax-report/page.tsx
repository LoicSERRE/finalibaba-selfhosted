export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db/prisma";
import { Receipt, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportTaxReportButton, type TaxReportExportData } from "@/components/shared/export-tax-report-button";
import { getAccountTaxRate } from "@/lib/domain/tax";
import { formatCurrency, localeToIntl } from "@/lib/utils/format";
import { getTranslations, getLocale } from "next-intl/server";

export default async function TaxReportPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yearParam } = await searchParams;
  const [t, tc, locale] = await Promise.all([getTranslations("taxReport"), getTranslations("common"), getLocale()]);
  const intlLocale = localeToIntl(locale);

  const now = new Date();
  const year = yearParam ? parseInt(yearParam, 10) : now.getUTCFullYear();
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const startOfNextYear = new Date(Date.UTC(year + 1, 0, 1));

  const [sales, incomeEvents] = await Promise.all([
    prisma.sale.findMany({
      where: { date: { gte: startOfYear, lt: startOfNextYear } },
      include: { account: { select: { name: true, taxTreatment: true, taxRatePct: true } } },
      orderBy: { date: "desc" },
    }),
    prisma.incomeEvent.findMany({
      where: { date: { gte: startOfYear, lt: startOfNextYear } },
      include: { account: { select: { name: true } } },
      orderBy: { date: "desc" },
    }),
  ]);

  const salesWithGain = sales.map((s) => {
    const gainCents = s.proceedsCents - s.costBasisCents;
    const rate = getAccountTaxRate(s.account);
    // Per-row reference figure only (as if this were the year's only sale) -
    // the actual estimated tax due (totalGainTaxCents below) nets gains and
    // losses per account first, same convention as the account-detail page's
    // aggregate tax figure.
    const taxCents = rate !== null && gainCents > BigInt(0) ? BigInt(Math.round(Number(gainCents) * rate)) : BigInt(0);
    return { ...s, gainCents, taxCents };
  });
  const totalRealizedGainCents = salesWithGain.reduce((sum, s) => sum + s.gainCents, BigInt(0));

  // Net gains/losses per account for the year before taxing - taxing each
  // sale independently (summing per-row taxCents) would overstate tax due
  // whenever an account has both a gain and a loss sale in the same year.
  const netGainByAccount = new Map<string, { gainCents: bigint; rate: number | null }>();
  for (const s of salesWithGain) {
    const rate = getAccountTaxRate(s.account);
    const prev = netGainByAccount.get(s.accountId) ?? { gainCents: BigInt(0), rate };
    netGainByAccount.set(s.accountId, { gainCents: prev.gainCents + s.gainCents, rate });
  }
  let totalGainTaxCents = BigInt(0);
  for (const { gainCents, rate } of netGainByAccount.values()) {
    if (rate !== null && gainCents > BigInt(0)) {
      totalGainTaxCents += BigInt(Math.round(Number(gainCents) * rate));
    }
  }

  const netIncomeCents = (e: { amountCents: bigint; taxWithheldCents: bigint | null }) =>
    e.amountCents - (e.taxWithheldCents ?? BigInt(0));
  const dividends = incomeEvents.filter((e) => e.type === "DIVIDEND");
  const interest = incomeEvents.filter((e) => e.type === "INTEREST");
  const totalDividendsGrossCents = dividends.reduce((sum, e) => sum + e.amountCents, BigInt(0));
  const totalDividendsNetCents = dividends.reduce((sum, e) => sum + netIncomeCents(e), BigInt(0));
  const totalInterestGrossCents = interest.reduce((sum, e) => sum + e.amountCents, BigInt(0));
  const totalInterestNetCents = interest.reduce((sum, e) => sum + netIncomeCents(e), BigInt(0));

  const hasData = sales.length > 0 || incomeEvents.length > 0;

  const exportData: TaxReportExportData = {
    year,
    totalRealizedGainCents: Number(totalRealizedGainCents),
    totalGainTaxCents: Number(totalGainTaxCents),
    totalDividendsGrossCents: Number(totalDividendsGrossCents),
    totalDividendsNetCents: Number(totalDividendsNetCents),
    totalInterestGrossCents: Number(totalInterestGrossCents),
    totalInterestNetCents: Number(totalInterestNetCents),
    sales: salesWithGain.map((s) => ({
      ticker: s.ticker,
      accountName: s.account.name,
      date: s.date.toISOString().slice(0, 10),
      proceedsCents: Number(s.proceedsCents),
      costBasisCents: Number(s.costBasisCents),
      gainCents: Number(s.gainCents),
      taxCents: Number(s.taxCents),
    })),
    dividends: dividends.map((e) => ({
      ticker: e.ticker,
      accountName: e.account.name,
      date: e.date.toISOString().slice(0, 10),
      grossCents: Number(e.amountCents),
      netCents: Number(netIncomeCents(e)),
    })),
    interest: interest.map((e) => ({
      accountName: e.account.name,
      date: e.date.toISOString().slice(0, 10),
      grossCents: Number(e.amountCents),
      netCents: Number(netIncomeCents(e)),
    })),
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">{t("title")}</h1>
          <p className="text-sm text-[var(--muted)] mt-1">{t("subtitle")}</p>
        </div>
        {hasData && <ExportTaxReportButton data={exportData} />}
      </div>

      <div className="flex items-center justify-center gap-4">
        <Link
          href={`/tax-report?year=${year - 1}`}
          className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-elevated)] transition-colors"
          aria-label={tc("previous")}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </Link>
        <span className="text-lg font-semibold tabular-nums text-[var(--foreground)] w-16 text-center">{year}</span>
        <Link
          href={`/tax-report?year=${year + 1}`}
          className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-elevated)] transition-colors"
          aria-label={tc("next")}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </Link>
      </div>

      {!hasData ? (
        <EmptyState icon={Receipt} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-[var(--muted)] mb-1">{t("realizedGains")}</p>
                <p className={`text-lg font-semibold tabular-nums ${totalRealizedGainCents >= BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                  {totalRealizedGainCents >= BigInt(0) ? "+" : ""}
                  {formatCurrency(totalRealizedGainCents, 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)] mb-1">{t("estimatedTaxOnGains")}</p>
                <p className="text-lg font-semibold tabular-nums text-[var(--negative)]">-{formatCurrency(totalGainTaxCents, 0)}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)] mb-1">{t("dividendsNet")}</p>
                <p className="text-lg font-semibold tabular-nums text-[var(--positive)]">{formatCurrency(totalDividendsNetCents, 0)}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)] mb-1">{t("interestNet")}</p>
                <p className="text-lg font-semibold tabular-nums text-[var(--positive)]">{formatCurrency(totalInterestNetCents, 0)}</p>
              </div>
            </div>
            <p className="text-xs text-[var(--muted)] mt-4 opacity-70">{t("disclaimer")}</p>
          </div>

          {salesWithGain.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-[var(--border)]">
                <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("realizedGains")}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      {[t("colDate"), t("colTicker"), t("colAccount"), t("colProceeds"), t("colCostBasis"), t("colGain"), t("colTax")].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {salesWithGain.map((s) => (
                      <tr key={s.id} className="border-b border-[var(--border)] last:border-0">
                        <td className="px-4 py-3 text-[var(--muted)] tabular-nums whitespace-nowrap text-xs">
                          {new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", year: "numeric" }).format(s.date)}
                        </td>
                        <td className="px-4 py-3 text-[var(--foreground)] font-medium">{s.ticker}</td>
                        <td className="px-4 py-3 text-[var(--muted)]">{s.account.name}</td>
                        <td className="px-4 py-3 tabular-nums">{formatCurrency(s.proceedsCents)}</td>
                        <td className="px-4 py-3 tabular-nums">{formatCurrency(s.costBasisCents)}</td>
                        <td className={`px-4 py-3 tabular-nums font-medium ${s.gainCents >= BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                          {s.gainCents >= BigInt(0) ? "+" : ""}
                          {formatCurrency(s.gainCents)}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-[var(--negative)]">-{formatCurrency(s.taxCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {dividends.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-[var(--border)]">
                <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("dividendIncome")}</h2>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {dividends.map((e) => (
                  <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
                    <div className="min-w-0">
                      <p className="text-sm text-[var(--foreground)]">{e.ticker ?? e.account.name}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {e.account.name} · {new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short" }).format(e.date)}
                      </p>
                    </div>
                    <p className="text-sm tabular-nums font-medium text-[var(--positive)]">{formatCurrency(netIncomeCents(e))}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {interest.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-[var(--border)]">
                <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("interestIncome")}</h2>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {interest.map((e) => (
                  <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
                    <div className="min-w-0">
                      <p className="text-sm text-[var(--foreground)]">{e.account.name}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short" }).format(e.date)}
                      </p>
                    </div>
                    <p className="text-sm tabular-nums font-medium text-[var(--positive)]">{formatCurrency(netIncomeCents(e))}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
