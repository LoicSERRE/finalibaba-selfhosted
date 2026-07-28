export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { localeToIntl } from "@/lib/format";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Upload } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ImportBalanceHistoryDialog } from "@/components/import-balance-history-dialog";
import { ImportTransactionsDialog } from "@/components/import-transactions-dialog";
import { getTranslations, getLocale } from "next-intl/server";
import { computeAccountDetail } from "@/lib/account-detail";
import { AccountHeader } from "@/components/account-detail/account-header";
import { BalanceChartSection } from "@/components/account-detail/balance-chart-section";
import { HoldingsTable } from "@/components/account-detail/holdings-table";
import { RebalancingSection } from "@/components/account-detail/rebalancing-section";
import { FiscalSummarySection } from "@/components/account-detail/fiscal-summary-section";
import { InvestmentFormsSection } from "@/components/account-detail/investment-forms-section";
import { RealEstateSection } from "@/components/account-detail/real-estate-section";
import { AutomobileSection } from "@/components/account-detail/automobile-section";
import { LoanSection } from "@/components/account-detail/loan-section";
import { TransactionsTable } from "@/components/account-detail/transactions-table";
import { BalanceHistoryTable } from "@/components/account-detail/balance-history-table";
import { hasLoanParams } from "@/lib/loan";

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [td, ta, t, locale] = await Promise.all([
    getTranslations("accountDetail"),
    getTranslations("accountTypes"),
    getTranslations("accounts"),
    getLocale(),
  ]);
  const intlLocale = localeToIntl(locale);

  const [account, categories] = await Promise.all([
    prisma.account.findUnique({
      where: { id },
      include: {
        institution: true,
        history: { orderBy: { recordedAt: "desc" }, take: 120 },
        holdings: { orderBy: { ticker: "asc" } },
        transactions: { orderBy: { date: "desc" }, take: 200 },
      },
    }),
    prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
  ]);

  if (!account) notFound();

  const result = computeAccountDetail({ account, intlLocale, now: new Date() });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Back nav */}
      <Link
        href={`/accounts?tab=${result.backTab}`}
        className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors py-2 min-h-[44px]"
      >
        <ArrowLeft size={14} />
        {td("backToAccounts")}
      </Link>

      <AccountHeader
        td={td}
        ta={ta}
        account={account}
        subtypeLabel={result.subtypeLabel}
        isFiat={result.isFiat}
        isInvestment={result.isInvestment}
        isRealEstate={result.isRealEstate}
        isAutomobile={result.isAutomobile}
        isLoan={result.isLoan}
        isSynced={result.isSynced}
        currentValue={result.currentValue}
        latestDelta={result.latestDelta}
        hasCostBasis={result.hasCostBasis}
        taxRate={result.taxRate}
        netAfterTax={result.netAfterTax}
        value={result.value}
        liability={result.liability}
      />

      {result.isFiat && (
        <BalanceChartSection
          td={td}
          accountId={account.id}
          chartData={result.chartData}
          canImportCsv={result.canImportCsv}
          existingBalanceDates={result.existingBalanceDates}
        />
      )}

      {result.isInvestment && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
          <HoldingsTable
            td={td}
            t={t}
            accountId={account.id}
            accountName={account.name}
            holdingsWithTax={result.holdingsWithTax}
            isSynced={result.isSynced}
          />

          <RebalancingSection td={td} rebalancingRows={result.rebalancingRows} />

          <FiscalSummarySection
            td={td}
            hasCostBasis={result.hasCostBasis}
            taxRate={result.taxRate}
            totalCostBasis={result.totalCostBasis}
            totalGain={result.totalGain}
            totalGainPct={result.totalGainPct}
            totalTax={result.totalTax}
            netAfterTax={result.netAfterTax}
            holdingsCount={account.holdings.length}
          />

          <InvestmentFormsSection
            td={td}
            accountId={account.id}
            investmentStartDate={account.investmentStartDate}
            taxTreatment={account.taxTreatment}
            taxRatePct={account.taxRatePct}
          />
        </div>
      )}

      {result.isRealEstate && (
        <RealEstateSection
          t={t}
          value={result.value}
          liability={result.liability}
          equity={result.equity}
          ltv={result.ltv}
        />
      )}

      {result.isAutomobile && (
        <AutomobileSection
          t={t}
          value={result.value}
          liability={result.liability}
          equity={result.equity}
          ltv={result.ltv}
          purchasePrice={result.purchasePrice}
        />
      )}

      {result.isLoan && result.loanStats && hasLoanParams(account) && (
        <LoanSection
          td={td}
          intlLocale={intlLocale}
          loanStats={result.loanStats}
          loanAmountCents={account.loanAmountCents}
          loanTaeg={account.loanTaeg}
          loanDurationMonths={account.loanDurationMonths}
          loanDeferralMonths={account.loanDeferralMonths}
          loanStartDate={account.loanStartDate}
          insuranceMonthlyCents={account.insuranceMonthlyCents}
        />
      )}

      {result.isFiat && account.transactions.length > 0 && (
        <TransactionsTable
          td={td}
          intlLocale={intlLocale}
          accountId={account.id}
          transactions={account.transactions}
          categories={categories}
          canImportCsv={result.canImportCsv}
          existingFingerprints={result.existingFingerprints}
        />
      )}

      {result.isFiat && account.transactions.length === 0 && (
        <BalanceHistoryTable
          td={td}
          intlLocale={intlLocale}
          accountId={account.id}
          historyRows={result.historyRows}
          canImportCsv={result.canImportCsv}
          existingBalanceDates={result.existingBalanceDates}
          existingFingerprints={result.existingFingerprints}
        />
      )}

      {/* Empty state - manual fiat account with nothing recorded yet */}
      {result.canImportCsv && account.transactions.length === 0 && result.historyRows.length === 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl">
          <EmptyState
            icon={Upload}
            title={td("importEmptyTitle")}
            description={td("importEmptyDescription")}
            action={
              <div className="flex items-center gap-2">
                <ImportBalanceHistoryDialog accountId={account.id} existingDates={result.existingBalanceDates} />
                <ImportTransactionsDialog accountId={account.id} existingFingerprints={result.existingFingerprints} />
              </div>
            }
          />
        </div>
      )}
    </div>
  );
}
