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
  ISIN_TO_YF_SYMBOL,
  BENCHMARK_SYMBOLS,
} from "@/lib/domain/analytics";
import { fetchYFDividends, fetchYFPriceHistory } from "@/lib/services/yahoo-finance";
import { KpiCards } from "@/components/analytics/kpi-cards";
import { CashflowCards } from "@/components/analytics/cashflow-cards";
import { GoalAndPassiveIncome } from "@/components/analytics/goal-and-passive-income";
import { ChartsSection } from "@/components/analytics/charts-section";
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

  const [accounts, allBalances, settings, yfData, incomeEventsYtd, msciWorldHistory, sp500History, cac40History] = await Promise.all([
    prisma.account.findMany({
      include: {
        institution: true,
        holdings: true,
        history: { orderBy: { recordedAt: "desc" }, take: 1 },
      },
    }),
    prisma.historicalBalance.findMany({ orderBy: { recordedAt: "asc" } }),
    prisma.userSettings.upsert({ where: { id: "singleton" }, create: {}, update: {} }),
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
    yfData,
    incomeEventsYtd,
    msciWorldHistory,
    sp500History,
    cac40History,
    intlLocale,
    now: new Date(),
  });

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
    <div className="max-w-5xl mx-auto space-y-8">
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
            goalCents={result.goalCents}
            goalPct={result.goalPct}
            goalRemaining={result.goalRemaining}
            netWorth={result.netWorth}
            realYtdPassiveNetCents={result.realYtdPassiveNetCents}
            realYtdDividendsNetCents={result.realYtdDividendsNetCents}
            realYtdInterestNetCents={result.realYtdInterestNetCents}
          />

          <ChartsSection
            t={t}
            dailyHistory={result.dailyHistory}
            allocationSlices={allocationSlicesForChart}
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
            techPct={result.techPct}
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
