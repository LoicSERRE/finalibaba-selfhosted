export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/format";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Upload } from "lucide-react";
import { InstitutionLogo } from "@/components/institution-logo";
import { getInstitutionLogoUrl } from "@/lib/institutions";
import { BalanceHistoryChart } from "@/components/balance-history-chart";
import { UpdateRealEstateDialog } from "@/components/update-real-estate-dialog";
import { UpdateAutomobileDialog } from "@/components/update-automobile-dialog";
import { AddHoldingDialog } from "@/components/add-holding-dialog";
import { SellHoldingDialog } from "@/components/sell-holding-dialog";
import { DeleteAccountButton } from "@/components/delete-account-button";
import { ImportTransactionsDialog } from "@/components/import-transactions-dialog";
import { ImportBalanceHistoryDialog } from "@/components/import-balance-history-dialog";
import { TransactionCategorySelect } from "@/components/transaction-category-select";
import { EmptyState } from "@/components/empty-state";
import { updateInvestmentStartDate, updateAccountTaxTreatment } from "@/lib/actions/accounts";
import Decimal from "decimal.js";
import { calcLoanStats, hasLoanParams } from "@/lib/loan";
import { getAccountTaxRate } from "@/lib/tax";
import { getTranslations } from "next-intl/server";

const TYPE_TO_TAB: Record<string, string> = {
  CHECKING: "liquidites",
  SAVINGS: "liquidites",
  MEAL_VOUCHER: "liquidites",
  INVESTMENT: "investissements",
  CRYPTO: "investissements",
  REAL_ESTATE: "immobilier",
  AUTOMOBILE: "automobiles",
  LOAN: "credits",
};

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [td, ta, t] = await Promise.all([
    getTranslations("accountDetail"),
    getTranslations("accountTypes"),
    getTranslations("accounts"),
  ]);

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

  const isFiat = ["CHECKING", "SAVINGS", "MEAL_VOUCHER"].includes(account.type);
  const isInvestment = ["INVESTMENT", "CRYPTO"].includes(account.type);
  const isRealEstate = account.type === "REAL_ESTATE";
  const isAutomobile = account.type === "AUTOMOBILE";
  const isLoan = account.type === "LOAN";
  const isSynced = !!account.syncId;
  const canImportCsv = isFiat && !isSynced && !account.gocardlessAccountId;
  const existingFingerprints = account.transactions.map(
    (tx) => `${tx.date.toISOString().slice(0, 10)}|${tx.label.trim().toLowerCase()}|${tx.amountCents.toString()}`
  );
  const existingBalanceDates = account.history.map((h) => h.recordedAt.toISOString().slice(0, 10));

  const taxRate = getAccountTaxRate(account);

  // Loan stats (calculated once)
  const loanStats =
    isLoan && hasLoanParams(account)
      ? calcLoanStats(
          {
            loanAmountCents: account.loanAmountCents,
            loanTaeg: account.loanTaeg,
            loanDurationMonths: account.loanDurationMonths,
            loanDeferralMonths: account.loanDeferralMonths ?? 0,
            loanStartDate: account.loanStartDate,
          },
          account.insuranceMonthlyCents ?? BigInt(0)
        )
      : null;

  // Current value
  let currentValue = BigInt(0);
  if (isRealEstate || isAutomobile) {
    currentValue = account.manualValueCents ?? BigInt(0);
  } else if (isLoan) {
    currentValue = loanStats?.currentCapitalCents ?? (account.liabilityCents ?? BigInt(0));
  } else if (isInvestment) {
    currentValue = account.holdings.reduce((sum, h) => {
      const v = new Decimal(h.quantity.toString())
        .mul(h.lastPriceCents.toString())
        .round()
        .toNumber();
      return sum + BigInt(v);
    }, BigInt(0));
  } else {
    currentValue = account.history[0]?.balanceCents ?? BigInt(0);
  }

  // Delta vs previous record (fiat)
  const latestDelta =
    account.history.length >= 2
      ? account.history[0].balanceCents - account.history[1].balanceCents
      : null;

  // Chart data - chronological, last 60 points
  const chartData = [...account.history]
    .reverse()
    .slice(-60)
    .map((h) => ({
      date: new Intl.DateTimeFormat("fr-FR", {
        day: "numeric",
        month: "short",
      }).format(h.recordedAt),
      balance: Number(h.balanceCents),
    }));

  // History rows with deltas (desc order)
  const historyRows = account.history.map((h, i) => ({
    ...h,
    delta:
      i < account.history.length - 1
        ? h.balanceCents - account.history[i + 1].balanceCents
        : null,
  }));

  // Real estate / automobile fields
  const value = account.manualValueCents ?? BigInt(0);
  const liability = account.liabilityCents ?? BigInt(0);
  const equity = value - liability;
  const ltv = value > BigInt(0) ? Math.round((Number(liability) / Number(value)) * 100) : 0;

  const purchasePrice = account.purchasePriceCents ?? BigInt(0);
  const backTab = TYPE_TO_TAB[account.type] ?? "liquidites";

  // ── Fiscal calculations (investments) ─────────────────────────────────────
  type HoldingWithTax = {
    id: string;
    ticker: string;
    name: string | null;
    quantity: Decimal;
    lastPriceCents: bigint;
    costBasisCents: bigint | null;
    marketValueCents: bigint;
    gainCents: bigint | null;       // null = no cost basis known
    gainPct: number | null;
    taxCents: bigint | null;
    pct: number;                    // % of account total
  };

  let totalCostBasis = BigInt(0);
  let totalGain = BigInt(0);
  let hasCostBasis = false;

  const holdingsWithTax: HoldingWithTax[] = account.holdings.map((h) => {
    const marketValueCents = BigInt(
      new Decimal(h.quantity.toString())
        .mul(h.lastPriceCents.toString())
        .round()
        .toNumber()
    );

    const pct =
      currentValue > BigInt(0)
        ? Math.round((Number(marketValueCents) / Number(currentValue)) * 100)
        : 0;

    if (h.costBasisCents == null || taxRate === null) {
      return { ...h, marketValueCents, gainCents: null, gainPct: null, taxCents: null, pct };
    }

    hasCostBasis = true;
    const gainCents = marketValueCents - h.costBasisCents;
    const gainPct =
      h.costBasisCents > BigInt(0)
        ? (Number(gainCents) / Number(h.costBasisCents)) * 100
        : null;
    // Tax only on positive gains (per-position display)
    const taxCents =
      gainCents > BigInt(0) ? BigInt(Math.round(Number(gainCents) * taxRate)) : BigInt(0);

    totalCostBasis += h.costBasisCents;
    totalGain += gainCents;

    return { ...h, marketValueCents, gainCents, gainPct, taxCents, pct };
  });

  const totalGainPct =
    hasCostBasis && totalCostBasis > BigInt(0)
      ? (Number(totalGain) / Number(totalCostBasis)) * 100
      : null;
  // Tax on NET gain (losses offset gains - matches French PFU logic for hypothetical full liquidation)
  const totalTax =
    hasCostBasis && taxRate !== null && totalGain > BigInt(0)
      ? BigInt(Math.round(Number(totalGain) * taxRate))
      : BigInt(0);
  const netAfterTax = currentValue - totalTax;

  // Subtype label
  const subtypeLabel =
    account.type === "INVESTMENT" && account.investmentSubtype
      ? ` · ${account.investmentSubtype}`
      : account.type === "CRYPTO"
      ? " · 31.4% flat tax"
      : "";

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Back nav */}
      <Link
        href={`/accounts?tab=${backTab}`}
        className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors py-2 min-h-[44px]"
      >
        <ArrowLeft size={14} />
        {td("backToAccounts")}
      </Link>

      {/* Account header */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              {account.institution && (
                <InstitutionLogo
                  name={account.institution.name}
                  logoUrl={account.institution.logoUrl ?? getInstitutionLogoUrl(account.institution.name)}
                  size={28}
                />
              )}
              <p className="text-xs text-[var(--muted)]">
                {account.institution?.name && `${account.institution.name} · `}{ta(account.type as Parameters<typeof ta>[0])}{subtypeLabel}
              </p>
            </div>
            <h1 className="text-2xl font-semibold text-[var(--foreground)]">{account.name}</h1>
            {isFiat && latestDelta !== null && latestDelta !== BigInt(0) && (
              <p
                className={`text-sm tabular-nums mt-2 ${
                  latestDelta > BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"
                }`}
              >
                {td("syncChanged", { delta: `${latestDelta > BigInt(0) ? "+" : ""}${formatCurrency(latestDelta)}` })}
              </p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className={`text-2xl sm:text-3xl font-semibold tabular-nums ${isLoan ? "text-[var(--negative)]" : "text-[var(--accent)]"}`}>
              {formatCurrency(currentValue, 0)}
            </p>
            {isInvestment && hasCostBasis && taxRate !== null && (
              <p className="text-xs text-[var(--muted)] mt-1">
                {td("afterTax", { amount: formatCurrency(netAfterTax, 0) })}
              </p>
            )}
            {isFiat && !isSynced && (
              <div className="mt-3 flex justify-end">
                <DeleteAccountButton
                  id={account.id}
                  name={account.name}
                  backHref="/accounts?tab=liquidites"
                />
              </div>
            )}
            {isInvestment && !isSynced && (
              <div className="mt-3 flex justify-end">
                <DeleteAccountButton
                  id={account.id}
                  name={account.name}
                  backHref="/accounts?tab=investissements"
                />
              </div>
            )}
            {isRealEstate && (
              <div className="flex items-center gap-2 mt-3 justify-end">
                <UpdateRealEstateDialog
                  id={account.id}
                  name={account.name}
                  valueCents={value}
                  liabilityCents={liability}
                />
                {!isSynced && (
                  <DeleteAccountButton
                    id={account.id}
                    name={account.name}
                    backHref="/accounts?tab=immobilier"
                  />
                )}
              </div>
            )}
            {isAutomobile && (
              <div className="flex items-center gap-2 mt-3 justify-end">
                <UpdateAutomobileDialog
                  id={account.id}
                  name={account.name}
                  valueCents={value}
                  liabilityCents={liability}
                  insuranceMonthlyCents={account.insuranceMonthlyCents ?? BigInt(0)}
                />
                {!isSynced && (
                  <DeleteAccountButton
                    id={account.id}
                    name={account.name}
                    backHref="/accounts?tab=automobiles"
                  />
                )}
              </div>
            )}
            {isLoan && !isSynced && (
              <div className="flex items-center gap-2 mt-3 justify-end">
                <DeleteAccountButton
                  id={account.id}
                  name={account.name}
                  backHref="/accounts?tab=credits"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Balance chart - fiat only */}
      {isFiat && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
              {td("balanceEvolution")}
            </h2>
            {canImportCsv && (
              <ImportBalanceHistoryDialog accountId={account.id} existingDates={existingBalanceDates} />
            )}
          </div>
          <BalanceHistoryChart data={chartData} />
        </div>
      )}

      {/* Holdings - investments & crypto */}
      {isInvestment && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
            <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
              {td("positions", { count: account.holdings.length, suffix: account.holdings.length !== 1 ? "s" : "" })}
            </h2>
          </div>
          {account.holdings.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-[var(--muted)]">
              {t("noHoldings")}
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("table.asset")}</th>
                  <th scope="col" className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("table.qty")}</th>
                  <th scope="col" className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("table.price")}</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("table.value")}</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("table.gain")}</th>
                  <th scope="col" className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("table.tax")}</th>
                  <th scope="col" className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("table.weight")}</th>
                  {!isSynced && <th scope="col" className="px-4 py-3 w-10" />}
                </tr>
              </thead>
              <tbody>
                {holdingsWithTax.map((h, i) => (
                  <tr
                    key={h.id}
                    className={`${
                      i < holdingsWithTax.length - 1 ? "border-b border-[var(--border)]" : ""
                    } hover:bg-[var(--surface-elevated)] transition-colors`}
                  >
                    <td className="px-4 py-4">
                      <p className="font-medium text-[var(--foreground)]">{h.name || h.ticker}</p>
                      <p className="text-xs text-[var(--muted)] mt-0.5">{h.ticker}</p>
                    </td>
                    <td className="hidden sm:table-cell px-4 py-4 tabular-nums text-[var(--foreground)]">
                      {new Decimal(h.quantity.toString()).toSignificantDigits(6).toString()}
                    </td>
                    <td className="hidden sm:table-cell px-4 py-4 tabular-nums text-[var(--foreground)]">
                      {formatCurrency(h.lastPriceCents)}
                    </td>
                    <td className="px-4 py-4 tabular-nums font-semibold text-[var(--foreground)]">
                      {formatCurrency(h.marketValueCents)}
                    </td>
                    {/* Plus-value */}
                    <td className="px-4 py-4 tabular-nums">
                      {h.gainCents === null ? (
                        <span className="text-[var(--muted)] text-xs">-</span>
                      ) : (
                        <div>
                          <p
                            className={`font-medium ${
                              h.gainCents >= BigInt(0)
                                ? "text-[var(--positive)]"
                                : "text-[var(--negative)]"
                            }`}
                          >
                            {h.gainCents >= BigInt(0) ? "+" : ""}
                            {formatCurrency(h.gainCents)}
                          </p>
                          {h.gainPct !== null && (
                            <p
                              className={`text-xs ${
                                h.gainPct >= 0
                                  ? "text-[var(--positive)]"
                                  : "text-[var(--negative)]"
                              }`}
                            >
                              {h.gainPct >= 0 ? "+" : ""}
                              {h.gainPct.toFixed(1)}%
                            </p>
                          )}
                        </div>
                      )}
                    </td>
                    {/* Impôt latent */}
                    <td className="hidden sm:table-cell px-4 py-4 tabular-nums">
                      {h.taxCents === null ? (
                        <span className="text-[var(--muted)] text-xs">-</span>
                      ) : h.taxCents === BigInt(0) ? (
                        <span className="text-[var(--muted)] text-xs">0,00 €</span>
                      ) : (
                        <p className="text-[var(--negative)] font-medium">
                          -{formatCurrency(h.taxCents)}
                        </p>
                      )}
                    </td>
                    {/* Poids */}
                    <td className="hidden sm:table-cell px-4 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-12 bg-[var(--surface-elevated)] rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full bg-[var(--accent)]"
                            style={{ width: `${h.pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-[var(--muted)] tabular-nums w-7 text-right">
                          {h.pct}%
                        </span>
                      </div>
                    </td>
                    {!isSynced && (
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap items-center gap-1">
                          <SellHoldingDialog accountId={account.id} holding={h} />
                          <AddHoldingDialog
                            accountId={account.id}
                            accountName={account.name}
                            existing={h}
                          />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}

          {/* Résumé fiscal */}
          {hasCostBasis && taxRate !== null && (
            <div className="border-t border-[var(--border)] px-6 py-4 bg-[var(--surface-elevated)]">
              <div className="flex items-center justify-between gap-6 text-sm flex-wrap">
                <div>
                  <p className="text-xs text-[var(--muted)] mb-0.5">{td("fiscalSummary.costBasis")}</p>
                  <p className="tabular-nums font-medium text-[var(--foreground)]">
                    {formatCurrency(totalCostBasis)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted)] mb-0.5">{td("fiscalSummary.latentGain")}</p>
                  <p
                    className={`tabular-nums font-semibold ${
                      totalGain >= BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"
                    }`}
                  >
                    {totalGain >= BigInt(0) ? "+" : ""}
                    {formatCurrency(totalGain)}
                    {totalGainPct !== null && (
                      <span className="text-xs font-normal ml-1">
                        ({totalGainPct >= 0 ? "+" : ""}
                        {totalGainPct.toFixed(1)}%)
                      </span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted)] mb-0.5">
                    {td("fiscalSummary.taxLabel", { rate: ((taxRate ?? 0) * 100).toFixed(1) })}
                  </p>
                  <p className="tabular-nums font-semibold text-[var(--negative)]">
                    -{formatCurrency(totalTax)}
                  </p>
                </div>
                <div className="sm:border-l sm:border-[var(--border)] sm:pl-6">
                  <p className="text-xs text-[var(--muted)] mb-0.5">{td("fiscalSummary.netAfterTax")}</p>
                  <p className="tabular-nums font-semibold text-[var(--accent-text)]">
                    {formatCurrency(netAfterTax)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Hint si pas de prix de revient */}
          {!hasCostBasis && isInvestment && account.holdings.length > 0 && (
            <div className="border-t border-[var(--border)] px-6 py-3 text-xs text-[var(--muted)]">
              {taxRate === null ? td("fiscalSubtype") : td("fiscalTip")}
            </div>
          )}

          {/* Date de début d'investissement */}
          <div className="border-t border-[var(--border)] px-6 py-4">
            <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-3">
              {td("investmentStartDate")}
            </p>
            <form action={updateInvestmentStartDate} className="flex items-center gap-3">
              <input type="hidden" name="id" value={account.id} />
              <input
                type="date"
                name="investmentStartDate"
                defaultValue={
                  account.investmentStartDate
                    ? account.investmentStartDate.toISOString().slice(0, 10)
                    : ""
                }
                className="text-sm bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 transition-colors"
              />
              <button
                type="submit"
                className="text-xs px-3 py-2 rounded-lg bg-[var(--accent)]/15 text-[var(--accent-text)] hover:bg-[var(--accent)]/25 active:scale-[0.97] transition cursor-pointer font-medium min-h-[44px]"
              >
                {td("fiscalSummary.save")}
              </button>
              {account.investmentStartDate && (
                <span className="text-xs text-[var(--muted)]">
                  {td("fiscalSummary.annualizedHint")}
                </span>
              )}
            </form>
          </div>

          {/* Régime fiscal */}
          <div className="border-t border-[var(--border)] px-6 py-4">
            <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-3">
              {td("fiscalSummary.taxTreatmentLabel")}
            </p>
            <form action={updateAccountTaxTreatment} className="flex items-center gap-3 flex-wrap">
              <input type="hidden" name="id" value={account.id} />
              <select
                name="taxTreatment"
                defaultValue={account.taxTreatment}
                className="text-sm bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 transition-colors cursor-pointer"
              >
                <option value="TAXABLE">{td("fiscalSummary.taxTreatmentTaxable")}</option>
                <option value="EXEMPT">{td("fiscalSummary.taxTreatmentExempt")}</option>
                <option value="DEFERRED">{td("fiscalSummary.taxTreatmentDeferred")}</option>
              </select>
              <input
                type="number"
                name="taxRatePct"
                step="0.1"
                min="0"
                max="100"
                placeholder="%"
                defaultValue={account.taxRatePct != null ? (account.taxRatePct * 100).toFixed(1) : ""}
                className="w-24 text-sm bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 transition-colors"
              />
              <button
                type="submit"
                className="text-xs px-3 py-2 rounded-lg bg-[var(--accent)]/15 text-[var(--accent-text)] hover:bg-[var(--accent)]/25 active:scale-[0.97] transition cursor-pointer font-medium min-h-[44px]"
              >
                {td("fiscalSummary.save")}
              </button>
            </form>
            <Link href="/tax-report" className="text-xs text-[var(--accent-text)] hover:underline underline-offset-2 inline-block mt-3">
              {td("fiscalSummary.taxReportLink")}
            </Link>
          </div>
        </div>
      )}

      {/* Real estate detail */}
      {isRealEstate && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 text-sm">
            <div>
              <p className="text-xs text-[var(--muted)] mb-1">{t("realEstate.value")}</p>
              <p className="tabular-nums font-semibold text-[var(--foreground)]">
                {formatCurrency(value, 0)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--muted)] mb-1">{t("realEstate.remaining")}</p>
              <p className="tabular-nums font-semibold text-[var(--negative)]">
                {formatCurrency(liability, 0)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--muted)] mb-1">{t("realEstate.equity")}</p>
              <p className="tabular-nums font-semibold text-[var(--positive)]">
                {formatCurrency(equity, 0)}
              </p>
            </div>
          </div>
          {liability > BigInt(0) && (
            <div>
              <div className="flex justify-between text-xs text-[var(--muted)] mb-1.5">
                <span>LTV</span>
                <span>{ltv}%</span>
              </div>
              <div
                className="h-2 bg-[var(--surface-elevated)] rounded-full overflow-hidden"
                role="progressbar"
                aria-valuenow={ltv}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`LTV : ${ltv}%`}
              >
                <div
                  className={`h-full rounded-full ${
                    ltv > 80
                      ? "bg-[var(--negative)]"
                      : ltv > 60
                      ? "bg-[var(--warning)]"
                      : "bg-[var(--positive)]"
                  }`}
                  style={{ width: `${Math.min(ltv, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Automobile detail */}
      {isAutomobile && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 space-y-5">
          <div className={`grid gap-3 sm:gap-4 text-sm ${purchasePrice > BigInt(0) ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-2 sm:grid-cols-3"}`}>
            {purchasePrice > BigInt(0) && (
              <div>
                <p className="text-xs text-[var(--muted)] mb-1">{t("auto.purchasePrice")}</p>
                <p className="tabular-nums font-semibold text-[var(--foreground)]">
                  {formatCurrency(purchasePrice, 0)}
                </p>
              </div>
            )}
            <div>
              <p className="text-xs text-[var(--muted)] mb-1">{t("auto.value")}</p>
              <p className="tabular-nums font-semibold text-[var(--foreground)]">
                {formatCurrency(value, 0)}
              </p>
            </div>
            {purchasePrice > BigInt(0) && (() => {
              const depr = value - purchasePrice;
              const deprPct = Number(depr) / Number(purchasePrice) * 100;
              return (
                <div>
                  <p className="text-xs text-[var(--muted)] mb-1">{t("auto.depreciation")}</p>
                  <p className={`tabular-nums font-semibold ${depr <= BigInt(0) ? "text-[var(--negative)]" : "text-[var(--positive)]"}`}>
                    {depr > BigInt(0) ? "+" : ""}{formatCurrency(depr, 0)}
                  </p>
                  <p className={`text-xs tabular-nums ${depr <= BigInt(0) ? "text-[var(--negative)]" : "text-[var(--positive)]"}`}>
                    {deprPct >= 0 ? "+" : ""}{deprPct.toFixed(1)}%
                  </p>
                </div>
              );
            })()}
            <div>
              <p className="text-xs text-[var(--muted)] mb-1">{t("auto.loanDue")}</p>
              <p className="tabular-nums font-semibold text-[var(--negative)]">
                {formatCurrency(liability, 0)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--muted)] mb-1">{t("auto.netValue")}</p>
              <p className="tabular-nums font-semibold text-[var(--positive)]">
                {formatCurrency(equity, 0)}
              </p>
            </div>
          </div>
          {liability > BigInt(0) && (
            <div>
              <div className="flex justify-between text-xs text-[var(--muted)] mb-1.5">
                <span>{t("auto.financing")}</span>
                <span>{ltv}%</span>
              </div>
              <div
                className="h-2 bg-[var(--surface-elevated)] rounded-full overflow-hidden"
                role="progressbar"
                aria-valuenow={ltv}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${t("auto.financing")}: ${ltv}%`}
              >
                <div
                  className={`h-full rounded-full ${
                    ltv > 80
                      ? "bg-[var(--negative)]"
                      : ltv > 50
                      ? "bg-[var(--warning)]"
                      : "bg-[var(--positive)]"
                  }`}
                  style={{ width: `${Math.min(ltv, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loan detail */}
      {isLoan && loanStats && hasLoanParams(account) && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 space-y-6">
          {/* KPIs principaux */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 text-sm">
            <div>
              <p className="text-[var(--muted)] text-xs mb-1">{td("loanDetail.amountBorrowed")}</p>
              <p className="tabular-nums font-semibold text-[var(--foreground)]">
                {formatCurrency(account.loanAmountCents, 0)}
              </p>
            </div>
            <div>
              <p className="text-[var(--muted)] text-xs mb-1">{td("loanDetail.remaining")}</p>
              <p className="tabular-nums font-semibold text-[var(--negative)]">
                {formatCurrency(loanStats.currentCapitalCents, 0)}
              </p>
            </div>
            <div>
              <p className="text-[var(--muted)] text-xs mb-1">{td("loanDetail.taeg")}</p>
              <p className="tabular-nums font-semibold text-[var(--foreground)]">
                {account.loanTaeg.toFixed(2)} %
              </p>
            </div>
            <div>
              <p className="text-[var(--muted)] text-xs mb-1">{td("loanDetail.projectedEnd")}</p>
              <p className="tabular-nums font-semibold text-[var(--foreground)]">
                {new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric" }).format(loanStats.endDate)}
              </p>
            </div>
          </div>

          {/* Mensualités */}
          <div className="border-t border-[var(--border)] pt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            {(account.loanDeferralMonths ?? 0) > 0 && (
              <div>
                <p className="text-[var(--muted)] text-xs mb-1">
                  {td("loanDetail.monthlyDuring", { months: account.loanDeferralMonths! })}
                </p>
                <p className="tabular-nums font-semibold text-[var(--foreground)]">
                  {formatCurrency(loanStats.deferralPaymentCents + (account.insuranceMonthlyCents ?? BigInt(0)))}
                  <span className="text-xs text-[var(--muted)] font-normal ml-1">{td("loanDetail.perMonth")}</span>
                </p>
                <p className="text-xs text-[var(--muted)]">{td("loanDetail.interestOnly")}{(account.insuranceMonthlyCents ?? BigInt(0)) > BigInt(0) ? td("loanDetail.plusInsurance") : ""}</p>
              </div>
            )}
            <div>
              <p className="text-[var(--muted)] text-xs mb-1">
                {(account.loanDeferralMonths ?? 0) > 0 ? td("loanDetail.monthlyAfterDeferred") : td("loanDetail.monthly")}
              </p>
              <p className="tabular-nums font-semibold text-[var(--foreground)]">
                {formatCurrency(loanStats.amortPaymentCents + (account.insuranceMonthlyCents ?? BigInt(0)))}
                <span className="text-xs text-[var(--muted)] font-normal ml-1">{td("loanDetail.perMonth")}</span>
              </p>
              {(account.insuranceMonthlyCents ?? BigInt(0)) > BigInt(0) && (
                <p className="text-xs text-[var(--muted)]">
                  {td("loanDetail.insuranceAmount", { amount: formatCurrency(account.insuranceMonthlyCents!) })}
                </p>
              )}
            </div>
            <div>
              <p className="text-[var(--muted)] text-xs mb-1">{td("loanDetail.currentMonthly")}</p>
              <p className="tabular-nums font-semibold text-[var(--accent-text)]">
                {formatCurrency(loanStats.currentMonthlyTotalCents)}
                <span className="text-xs text-[var(--muted)] font-normal ml-1">{td("loanDetail.perMonth")}</span>
              </p>
            </div>
          </div>

          {/* Coût du crédit */}
          <div className="border-t border-[var(--border)] pt-4 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-[var(--muted)] text-xs mb-1">{td("loanDetail.totalInterest")}</p>
              <p className="tabular-nums font-semibold text-[var(--negative)]">
                {formatCurrency(loanStats.totalInterestCents, 0)}
              </p>
            </div>
            {(account.insuranceMonthlyCents ?? BigInt(0)) > BigInt(0) && (
              <div>
                <p className="text-[var(--muted)] text-xs mb-1">{td("loanDetail.totalInsurance")}</p>
                <p className="tabular-nums font-semibold text-[var(--negative)]">
                  {formatCurrency((account.insuranceMonthlyCents ?? BigInt(0)) * BigInt(account.loanDurationMonths), 0)}
                </p>
              </div>
            )}
            <div>
              <p className="text-[var(--muted)] text-xs mb-1">{td("loanDetail.totalCost")}</p>
              <p className="tabular-nums font-semibold text-[var(--negative)]">
                {formatCurrency(loanStats.totalCostCents, 0)}
              </p>
            </div>
          </div>

          {/* Barre de progression */}
          <div className="border-t border-[var(--border)] pt-4">
            <div className="flex justify-between text-xs text-[var(--muted)] mb-2">
              <span>
                {td("loanDetail.repaymentProgress", { elapsed: loanStats.monthsElapsed, total: account.loanDurationMonths })}
              </span>
              <span>{loanStats.progressPct}%</span>
            </div>
            <div
              className="h-2 bg-[var(--surface-elevated)] rounded-full overflow-hidden"
              role="progressbar"
              aria-valuenow={loanStats.progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${td("loanDetail.repaymentProgress", { elapsed: loanStats.monthsElapsed, total: account.loanDurationMonths })}: ${loanStats.progressPct}%`}
            >
              <div
                className={`h-full rounded-full transition-all ${
                  loanStats.progressPct > 75
                    ? "bg-[var(--positive)]"
                    : loanStats.progressPct > 40
                    ? "bg-[var(--accent)]"
                    : "bg-[var(--negative)]"
                }`}
                style={{ width: `${loanStats.progressPct}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-[var(--muted)] mt-2">
              <span>
                {new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric" }).format(account.loanStartDate)}
              </span>
              <span>
                {new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric" }).format(loanStats.endDate)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Transactions - fiat synced accounts */}
      {isFiat && account.transactions.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
            <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
              {td("transactions", { count: account.transactions.length, suffix: account.transactions.length !== 1 ? "s" : "" })}
            </h2>
            {canImportCsv && (
              <ImportTransactionsDialog accountId={account.id} existingFingerprints={existingFingerprints} />
            )}
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {[td("tableHeaders.date"), td("tableHeaders.label"), td("tableHeaders.category"), td("tableHeaders.amount")].map((h) => (
                  <th
                    key={h}
                    className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {account.transactions.map((tx, i) => (
                <tr
                  key={tx.id}
                  className={`${
                    i < account.transactions.length - 1 ? "border-b border-[var(--border)]" : ""
                  } hover:bg-[var(--surface-elevated)] transition-colors`}
                >
                  <td className="px-3 sm:px-6 py-3 text-[var(--muted)] tabular-nums whitespace-nowrap text-xs sm:text-sm">
                    {new Intl.DateTimeFormat("fr-FR", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    }).format(tx.date)}
                  </td>
                  <td className="px-3 sm:px-6 py-3 text-[var(--foreground)] max-w-[140px] sm:max-w-xs truncate" title={tx.label ?? undefined}>
                    {tx.label}
                  </td>
                  <td className="px-3 sm:px-6 py-3 whitespace-nowrap">
                    <TransactionCategorySelect transactionId={tx.id} categoryId={tx.categoryId} categories={categories} />
                  </td>
                  <td className="px-3 sm:px-6 py-3 tabular-nums font-medium whitespace-nowrap">
                    <span
                      className={
                        tx.amountCents > BigInt(0)
                          ? "text-[var(--positive)]"
                          : "text-[var(--negative)]"
                      }
                    >
                      {tx.amountCents > BigInt(0) ? "+" : ""}
                      {formatCurrency(tx.amountCents)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Balance history table - fiat without transactions (manual accounts) */}
      {isFiat && account.transactions.length === 0 && historyRows.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
            <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
              {td("history", { count: historyRows.length, suffix: historyRows.length !== 1 ? "s" : "" })}
            </h2>
            {canImportCsv && (
              <div className="flex items-center gap-2">
                <ImportBalanceHistoryDialog accountId={account.id} existingDates={existingBalanceDates} />
                <ImportTransactionsDialog accountId={account.id} existingFingerprints={existingFingerprints} />
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[320px]">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {[td("tableHeaders.date"), td("tableHeaders.balance"), td("tableHeaders.change")].map((h) => (
                  <th
                    key={h}
                    className="px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {historyRows.map((row, i) => (
                <tr
                  key={row.id}
                  className={`${
                    i < historyRows.length - 1 ? "border-b border-[var(--border)]" : ""
                  } hover:bg-[var(--surface-elevated)] transition-colors`}
                >
                  <td className="px-6 py-3 text-[var(--muted)] tabular-nums">
                    {new Intl.DateTimeFormat("fr-FR", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(row.recordedAt)}
                  </td>
                  <td className="px-6 py-3 tabular-nums font-medium text-[var(--foreground)]">
                    {formatCurrency(row.balanceCents)}
                  </td>
                  <td className="px-6 py-3 tabular-nums">
                    {row.delta === null ? (
                      <span className="text-[var(--muted)]">-</span>
                    ) : row.delta === BigInt(0) ? (
                      <span className="text-[var(--muted)]">±0</span>
                    ) : (
                      <span
                        className={
                          row.delta > BigInt(0)
                            ? "text-[var(--positive)]"
                            : "text-[var(--negative)]"
                        }
                      >
                        {row.delta > BigInt(0) ? "+" : ""}
                        {formatCurrency(row.delta)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Empty state - manual fiat account with nothing recorded yet */}
      {canImportCsv && account.transactions.length === 0 && historyRows.length === 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl">
          <EmptyState
            icon={Upload}
            title={td("importEmptyTitle")}
            description={td("importEmptyDescription")}
            action={
              <div className="flex items-center gap-2">
                <ImportBalanceHistoryDialog accountId={account.id} existingDates={existingBalanceDates} />
                <ImportTransactionsDialog accountId={account.id} existingFingerprints={existingFingerprints} />
              </div>
            }
          />
        </div>
      )}
    </div>
  );
}
