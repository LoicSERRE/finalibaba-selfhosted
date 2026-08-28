export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db/prisma";
import { getViewer, viewAccountIds } from "@/lib/auth-context";
import { formatCurrency, localeToIntl } from "@/lib/utils/format";
import Link from "next/link";
import { AddAccountDialog } from "@/components/accounts/add-account-dialog";
import { ExportAccountsButton } from "@/components/shared/export-accounts-button";
import { FiatTab } from "@/components/accounts/fiat-tab";
import { InvestmentTab } from "@/components/accounts/investment-tab";
import { RealEstateTab } from "@/components/accounts/real-estate-tab";
import { AutomobileTab } from "@/components/accounts/automobile-tab";
import { LoanTab } from "@/components/accounts/loan-tab";
import {
  computeFiatRow,
  computeInvestRow,
  computeRealEstateRow,
  computeAutomobileRow,
  computeLoanRow,
  computeTabTotals,
  toFiatExport,
  toInvestExport,
  toRealEstateExport,
  toAutomobileExport,
  toLoanExport,
  type AccountsTabId,
} from "@/lib/domain/accounts-page";
import { getTranslations, getLocale } from "next-intl/server";

export default async function AccountsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ tab?: string }>;
}>) {
  const [t, ta, td, locale] = await Promise.all([
    getTranslations("accounts"),
    getTranslations("accountTypes"),
    getTranslations("accountDetail"),
    getLocale(),
  ]);
  const intlLocale = localeToIntl(locale);

  const TABS = [
    { id: "liquidites" as const, label: t("tabs.cash"), labelShort: t("tabs.cashShort") },
    { id: "investissements" as const, label: t("tabs.investments"), labelShort: t("tabs.investmentsShort") },
    { id: "immobilier" as const, label: t("tabs.realEstate"), labelShort: t("tabs.realEstateShort") },
    { id: "automobiles" as const, label: t("tabs.autos"), labelShort: t("tabs.autosShort") },
    { id: "credits" as const, label: t("tabs.loans"), labelShort: t("tabs.loansShort") },
  ];

  const { tab: rawTab = "liquidites" } = await searchParams;
  const tab = (TABS.some((tb) => tb.id === rawTab) ? rawTab : "liquidites") as AccountsTabId;

  // Scoped to the viewer's visible accounts (own + co-owned); institutions
  // to the ones they own. Mono mode resolves to the owner, i.e. everything.
  const viewer = await getViewer();
  const accountIds = await viewAccountIds(viewer.id);

  const [fiatAccounts, investAccounts, realEstateAccounts, automobileAccounts, loanAccounts, institutions] =
    await Promise.all([
      prisma.account.findMany({
        where: { id: { in: accountIds }, type: { in: ["CHECKING", "SAVINGS", "MEAL_VOUCHER"] } },
        include: {
          institution: true,
          history: { orderBy: { recordedAt: "desc" }, take: 14 },
        },
        orderBy: [{ institution: { name: "asc" } }, { name: "asc" }],
      }),
      prisma.account.findMany({
        where: { id: { in: accountIds }, type: { in: ["INVESTMENT", "CRYPTO"] } },
        include: {
          institution: true,
          holdings: { orderBy: { ticker: "asc" } },
        },
        orderBy: [{ type: "asc" }, { name: "asc" }],
      }),
      prisma.account.findMany({
        where: { id: { in: accountIds }, type: "REAL_ESTATE" },
        include: { institution: true },
        orderBy: { name: "asc" },
      }),
      prisma.account.findMany({
        where: { id: { in: accountIds }, type: "AUTOMOBILE" },
        include: { institution: true },
        orderBy: { name: "asc" },
      }),
      prisma.account.findMany({
        where: { id: { in: accountIds }, type: "LOAN" },
        include: { institution: true },
        orderBy: { name: "asc" },
      }),
      prisma.institution.findMany({ where: { userId: viewer.id }, orderBy: { name: "asc" } }),
    ]);

  const now = new Date();
  const fiatRows = fiatAccounts.map(computeFiatRow);
  const investRows = investAccounts.map(computeInvestRow);
  const realEstateRows = realEstateAccounts.map(computeRealEstateRow);
  const automobileRows = automobileAccounts.map(computeAutomobileRow);
  const loanRows = loanAccounts.map((loan) => computeLoanRow(loan, now));
  const loanTotalCents = loanRows.reduce((sum, row, i) => {
    const capital = row.hasParams ? row.stats.currentCapitalCents : loanAccounts[i].liabilityCents ?? BigInt(0);
    return sum + capital;
  }, BigInt(0));

  const tabTotals = computeTabTotals({ fiatRows, investRows, realEstateRows, automobileRows, loanTotalCents });

  // Only liquidités/investissements ever render the generic AddAccountDialog
  // below (see the header) - immobilier/automobiles/credits each have their
  // own dedicated add dialog instead, so INVESTMENT/CHECKING are the only
  // reachable values here.
  const defaultType = tab === "investissements" ? "INVESTMENT" : "CHECKING";

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-2">
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">{t("title")}</h1>
        <div className="flex items-center gap-2 shrink-0">
          <ExportAccountsButton
            fiatAccounts={fiatRows.map(toFiatExport)}
            investAccounts={investRows.map(toInvestExport)}
            realEstateAccounts={realEstateRows.map(toRealEstateExport)}
            automobileAccounts={automobileRows.map(toAutomobileExport)}
            loanAccounts={loanRows.map((r) => toLoanExport(r, intlLocale)).filter((r) => r !== null)}
          />
          {/* immobilier/automobiles/credits have their own dedicated add
              dialog further down (with type-specific fields this generic
              one doesn't cover, or doesn't cover at all for LOAN) - showing
              this one too would be a second, partially-broken way to create
              the same account type. */}
          {(tab === "liquidites" || tab === "investissements") && (
            <AddAccountDialog institutions={institutions} defaultType={defaultType} />
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-5 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-1 gap-1">
        {TABS.map(({ id, label, labelShort }) => (
          <Link
            key={id}
            href={`/accounts?tab=${id}`}
            className={`flex flex-col items-center py-2.5 px-1 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              tab === id
                ? "bg-[var(--accent)]/15 text-[var(--accent-text)]"
                : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-elevated)]"
            }`}
          >
            <span className="text-xs font-medium sm:hidden">{labelShort}</span>
            <span className="text-sm font-medium hidden sm:block">{label}</span>
            <span className="hidden sm:block text-xs mt-0.5 tabular-nums opacity-75">
              {formatCurrency(tabTotals[id], 0)}
            </span>
          </Link>
        ))}
      </div>

      {tab === "liquidites" && <FiatTab t={t} ta={ta} rows={fiatRows} />}
      {tab === "investissements" && <InvestmentTab t={t} ta={ta} rows={investRows} />}
      {tab === "immobilier" && <RealEstateTab t={t} institutions={institutions} rows={realEstateRows} />}
      {tab === "credits" && <LoanTab t={t} td={td} intlLocale={intlLocale} institutions={institutions} rows={loanRows} />}
      {tab === "automobiles" && <AutomobileTab t={t} institutions={institutions} rows={automobileRows} />}
    </div>
  );
}
