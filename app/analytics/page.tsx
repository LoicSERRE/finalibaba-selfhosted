export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db/prisma";
import { localeToIntl } from "@/lib/utils/format";
import { AnalyticsEmptyState } from "@/components/analytics/analytics-empty-state";
import {
  ExportAnalyticsButton,
} from "@/components/shared/export-analytics-button";
import { getTranslations, getLocale } from "next-intl/server";
import {
  computeAnalytics,
  buildAnalyticsExport,
  holdingMarketValue,
  ISIN_TO_YF_SYMBOL,
  BENCHMARK_SYMBOLS,
} from "@/lib/domain/analytics";
import { fetchYFDividends, fetchYFPriceHistory, resolveHoldingSectorWeights } from "@/lib/services/yahoo-finance";
import { aggregateSectorExposure } from "@/lib/domain/sector-exposure";
import { SectorExposureSection } from "@/components/analytics/sector-exposure-section";
import { KpiCards } from "@/components/analytics/kpi-cards";
import { CashflowCards } from "@/components/analytics/cashflow-cards";
import { GoalAndPassiveIncome } from "@/components/analytics/goal-and-passive-income";
import { ChartsSection } from "@/components/analytics/charts-section";
import { ProjectionChart } from "@/components/analytics/projection-chart";
import { DividendCalendarSection } from "@/components/analytics/dividend-calendar-section";
import { InvestmentPerformanceSection } from "@/components/analytics/investment-performance-section";
import { BenchmarkSection } from "@/components/analytics/benchmark-section";
import { AllocationRadarSection } from "@/components/analytics/allocation-radar-section";
import { DetailedAllocationSection } from "@/components/analytics/detailed-allocation-section";
import { MonthlyPerformanceSection } from "@/components/analytics/monthly-performance-section";
import { TopAssetsSection } from "@/components/analytics/top-assets-section";
import { FinancingSection } from "@/components/analytics/financing-section";

export default async function AnalyticsPage() {
  const [t, ta, tAlloc, tIncome, locale] = await Promise.all([
    getTranslations("analytics"),
    getTranslations("accountTypes"),
    getTranslations("allocation"),
    getTranslations("income"),
    getLocale(),
  ]);
  const intlLocale = localeToIntl(locale);

  const currentYear = new Date().getUTCFullYear();
  const startOfYear = new Date(Date.UTC(currentYear, 0, 1));
  const startOfNextYear = new Date(Date.UTC(currentYear + 1, 0, 1));

  const [accounts, allBalances, settings, goals, yfData, incomeEventsYtd, msciWorldHistory, sp500History, cac40History] = await Promise.all([
    prisma.account.findMany({
      include: {
        institution: true,
        holdings: true,
        history: { orderBy: { recordedAt: "desc" }, take: 1 },
      },
    }),
    prisma.historicalBalance.findMany({ orderBy: { recordedAt: "asc" } }),
    prisma.userSettings.upsert({ where: { id: "singleton" }, create: {}, update: {} }),
    // v1.14 - N independent goals (replaces the old single global
    // UserSettings.savingsGoalCents figure). No include needed -
    // computeAnalytics resolves each goal's linked account name/value
    // itself from the already-fetched `accounts` above.
    prisma.goal.findMany({ orderBy: { createdAt: "asc" } }),
    // Fetch Yahoo Finance in parallel - ex-div dates + real yields (1h cache)
    fetchYFDividends(Object.values(ISIN_TO_YF_SYMBOL)),
    // Real tracked income (IncomeEvent) - separate from the estimate below,
    // which still feeds the dividend calendar further down this page.
    prisma.incomeEvent.findMany({
      where: { date: { gte: startOfYear, lt: startOfNextYear } },
      select: { type: true, amountCents: true, taxWithheldCents: true },
    }),
    // Benchmark comparison - historical closes for the 3 reference indices (1h cache)
    fetchYFPriceHistory(BENCHMARK_SYMBOLS.msciWorld),
    fetchYFPriceHistory(BENCHMARK_SYMBOLS.sp500),
    fetchYFPriceHistory(BENCHMARK_SYMBOLS.cac40),
  ]);

  const result = computeAnalytics({
    accounts,
    allBalances,
    settings,
    goals,
    yfData,
    incomeEventsYtd,
    msciWorldHistory,
    sp500History,
    cac40History,
    intlLocale,
    now: new Date(),
  });

  // Full sector-exposure breakdown (v1.16) - depends on `accounts` above, so
  // it can't join the first Promise.all. See CLAUDE.md's "Full sector-
  // exposure breakdown" for the full design (Yahoo Finance's free
  // ISIN-resolution + crumb-gated ETF path, with two optional fallback
  // providers) behind resolveHoldingSectorWeights.
  //
  // CRYPTO-account holdings skip that resolution entirely - a real
  // imprecision found in production: BTC/ETH-style tickers aren't ISINs
  // Yahoo (or either fallback provider) can classify under a GICS sector,
  // so every crypto holding landed in "unclassified" indistinguishable from
  // a genuine data gap, understating how much of the "unclassified" slice
  // was actually just "this app doesn't try to sector-classify crypto,
  // because crypto doesn't have a GICS sector" - a true statement, not a
  // missing lookup. Bucketing by the holding's own account type (known
  // locally, no network round-trip) is both more accurate and cheaper than
  // attempting - and always failing - the Yahoo path for these.
  const investmentHoldings = accounts.filter((a) => a.type === "INVESTMENT").flatMap((a) => a.holdings);
  const cryptoHoldings = accounts.filter((a) => a.type === "CRYPTO").flatMap((a) => a.holdings);
  const investmentSectorWeights = await Promise.all(
    investmentHoldings.map((h) => resolveHoldingSectorWeights(h.ticker))
  );
  const sectorExposure = aggregateSectorExposure([
    ...investmentHoldings.map((h, i) => ({
      marketValueCents: holdingMarketValue(h),
      sectorWeights: investmentSectorWeights[i],
    })),
    ...cryptoHoldings.map((h) => ({
      marketValueCents: holdingMarketValue(h),
      sectorWeights: { crypto: 1 },
    })),
  ]);

  const allocationLabels = Object.fromEntries(
    result.allocationSlices.map((s) => [s.key, tAlloc(s.key as Parameters<typeof tAlloc>[0])])
  );
  const typeLabels = Object.fromEntries(
    (["CHECKING", "SAVINGS", "MEAL_VOUCHER", "INVESTMENT", "CRYPTO", "REAL_ESTATE", "AUTOMOBILE"] as const).map(
      (k) => [k, ta(k)]
    )
  );
  const analyticsExport = buildAnalyticsExport(result, allocationLabels, typeLabels);
  const allocationSlicesForChart = result.allocationSlices.map((s) => ({
    name: allocationLabels[s.key],
    value: s.value,
    color: s.color,
  }));

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">{t("title")}</h1>
          <p className="text-sm text-[var(--muted)] mt-1">{t("subtitle")}</p>
        </div>
        <div className="shrink-0"><ExportAnalyticsButton data={analyticsExport} /></div>
      </div>

      <KpiCards
        t={t}
        hasTaxData={result.hasTaxData}
        netWorth={result.netWorth}
        netWorthAfterTax={result.netWorthAfterTax}
        grossAssets={result.grossAssets}
        totalLiabilities={result.totalLiabilities}
        totalLatentTax={result.totalLatentTax}
        investedPct={result.investedPct}
        momDelta={result.momDelta}
      />

      {result.hasData && (
        <>
          <CashflowCards
            t={t}
            hasSalary={result.hasSalary}
            savingsRate={result.savingsRate}
            hasDeclaredSavings={result.hasDeclaredSavings}
            monthlySavedCents={result.monthlySavedCents}
            salaryNetCents={result.salaryNetCents}
            momDelta={result.momDelta}
            hasExpenses={result.hasExpenses}
            runwayMonths={result.runwayMonths}
            savingsCents={result.savingsCents}
            monthlyExpensesCents={result.monthlyExpensesCents}
          />

          <GoalAndPassiveIncome
            t={t}
            tIncome={tIncome}
            goals={result.goals}
            realYtdPassiveNetCents={result.realYtdPassiveNetCents}
            realYtdDividendsNetCents={result.realYtdDividendsNetCents}
            realYtdInterestNetCents={result.realYtdInterestNetCents}
          />

          <ChartsSection
            t={t}
            dailyHistory={result.dailyHistory}
            allocationSlices={allocationSlicesForChart}
          />

          <ProjectionChart
            currentNetWorthCents={result.netWorth}
            liquidCents={result.savingsCents}
            investedCents={result.risques}
            annualContributionCents={result.hasDeclaredSavings ? result.monthlySavedCents * BigInt(12) : null}
            defaultAnnualReturnPct={result.investCAGR !== null ? Math.max(0, Math.round(result.investCAGR * 10) / 10) : 5}
            effectiveTaxRate={result.effectiveTaxRate}
          />

          <DividendCalendarSection
            t={t}
            intlLocale={intlLocale}
            dividendCalendar={result.dividendCalendar}
            annualDividendsNetCents={result.annualDividendsNetCents}
            annualDividendsCents={result.annualDividendsCents}
          />

          <InvestmentPerformanceSection
            t={t}
            intlLocale={intlLocale}
            investPerfRows={result.investPerfRows}
            investTotalCostBasis={result.investTotalCostBasis}
            investTotalValue={result.investTotalValue}
            investTotalGain={result.investTotalGain}
            investTotalGainNet={result.investTotalGainNet}
            investTotalTax={result.investTotalTax}
            investReturnPct={result.investReturnPct}
            investCAGR={result.investCAGR}
            investAllHaveDates={result.investAllHaveDates}
            taxRatePea={result.taxRatePea}
            taxRateCto={result.taxRateCto}
          />

          <BenchmarkSection
            t={t}
            investCAGR={result.investCAGR}
            benchmarkCAGRs={result.benchmarkCAGRs}
          />

          <AllocationRadarSection
            t={t}
            garantis={result.garantis}
            risques={result.risques}
            garantisPct={result.garantisPct}
          />

          <SectorExposureSection
            t={t}
            breakdown={sectorExposure.breakdown}
            unclassifiedCents={sectorExposure.unclassifiedCents}
            totalCents={sectorExposure.totalCents}
          />

          <DetailedAllocationSection
            t={t}
            tAlloc={tAlloc}
            allocationSlices={result.allocationSlices}
            totalAllocation={result.totalAllocation}
          />

          <MonthlyPerformanceSection t={t} performanceRows={result.performanceRows} />

          <TopAssetsSection t={t} ta={ta} topAssets={result.topAssets} />

          <FinancingSection
            t={t}
            debtAccounts={result.debtAccounts}
            totalLiabilities={result.totalLiabilities}
            debtRatio={result.debtRatio}
            grossAssets={result.grossAssets}
          />
        </>
      )}

      {!result.hasData && <AnalyticsEmptyState />}
    </div>
  );
}
