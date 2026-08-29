export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db/prisma";
import { getViewContext } from "@/lib/auth-context";
import { localeToIntl } from "@/lib/utils/format";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Upload } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { ImportBalanceHistoryDialog } from "@/components/account-detail/import-balance-history-dialog";
import { ImportTransactionsDialog } from "@/components/account-detail/import-transactions-dialog";
import { getTranslations, getLocale } from "next-intl/server";
import { computeAccountDetail } from "@/lib/domain/account-detail";
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
import { hasLoanParams } from "@/lib/domain/loan";
import { CoOwnersSection } from "@/components/account-detail/co-owners-section";
import { isAuthEnabled } from "@/lib/auth-context";

export default async function AccountDetailPage({
  params,
}: Readonly<{
  params: Promise<{ id: string }>;
}>) {
  const { id } = await params;

  const [td, ta, t, locale] = await Promise.all([
    getTranslations("accountDetail"),
    getTranslations("accountTypes"),
    getTranslations("accounts"),
    getLocale(),
  ]);
  const intlLocale = localeToIntl(locale);

  // findFirst with an id-set filter, not findUnique by id: this page used to
  // render ANY account id handed to it. Resolving through the viewer's own
  // visible set means someone else's account 404s exactly like a nonexistent
  // one, leaking nothing about whether it exists.
  const { viewer, ownerId, accountIds, readOnly } = await getViewContext();

  const [account, categories] = await Promise.all([
    prisma.account.findFirst({
      where: { id, AND: { id: { in: accountIds } } },
      include: {
        institution: true,
        history: { orderBy: { recordedAt: "desc" }, take: 120 },
        holdings: { orderBy: { ticker: "asc" } },
        transactions: {
          orderBy: { date: "desc" },
          take: 200,
          include: { incomeEvent: { select: { id: true } }, splits: { select: { categoryId: true, amountCents: true } } },
        },
      },
    }),
    prisma.category.findMany({ where: { userId: ownerId }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
  ]);

  if (!account) notFound();

  const result = computeAccountDetail({ account, intlLocale, now: new Date() });
  // canImportCsv drives every CSV-import affordance on this page (the chart
  // section, the transactions table, the empty state). A granted portfolio is
  // read-only, so it's forced off here rather than at each of the three call
  // sites - assertCsvImportEligible would refuse a guest anyway, this just
  // stops the button existing.
  const canImportCsv = result.canImportCsv && !readOnly;

  // Co-ownership is only offered to the account's DIRECT owner (a co-owner
  // can't add further co-owners - see assertAccountOwner), and only with auth
  // on, since mono mode has nobody to share with. Fetched here rather than in
  // the Promise.all above because it depends on knowing the account exists.
  const isDirectOwner = isAuthEnabled() && !readOnly && account.userId === viewer.id;
  const coOwners = isDirectOwner
    ? await prisma.accountCoOwner.findMany({
        where: { accountId: account.id },
        select: { userId: true, user: { select: { username: true, displayName: true } } },
        orderBy: { createdAt: "asc" },
      })
    : [];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Back nav */}
      <Link
        href={`/accounts?tab=${result.backTab}`}
        className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors py-2 min-h-[44px] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
      >
        <ArrowLeft size={14} />
        {td("backToAccounts")}
      </Link>

      <AccountHeader
        readOnly={readOnly}
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

      {(result.isFiat || result.isInvestment) && (
        <BalanceChartSection
          td={td}
          accountId={account.id}
          chartData={result.chartData}
          canImportCsv={canImportCsv}
          existingBalanceDates={result.existingBalanceDates}
          isInvestment={result.isInvestment}
        />
      )}

      {result.isInvestment && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
          <HoldingsTable
            readOnly={readOnly}
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
            readOnly={readOnly}
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
          readOnly={readOnly}
          td={td}
          intlLocale={intlLocale}
          accountId={account.id}
          accountType={account.type}
          transactions={account.transactions}
          categories={categories}
          canImportCsv={canImportCsv}
          existingFingerprints={result.existingFingerprints}
        />
      )}

      {result.isFiat && account.transactions.length === 0 && (
        <BalanceHistoryTable
          td={td}
          intlLocale={intlLocale}
          accountId={account.id}
          historyRows={result.historyRows}
          canImportCsv={canImportCsv}
          existingBalanceDates={result.existingBalanceDates}
          existingFingerprints={result.existingFingerprints}
        />
      )}

      {isDirectOwner && (
        <CoOwnersSection
          accountId={account.id}
          coOwners={coOwners.map((c) => ({
            userId: c.userId,
            username: c.user.username,
            displayName: c.user.displayName,
          }))}
        />
      )}

      {/* Empty state - manual fiat account with nothing recorded yet */}
      {canImportCsv && account.transactions.length === 0 && result.historyRows.length === 0 && (
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
