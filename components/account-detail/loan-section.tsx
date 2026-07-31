import { formatCurrency } from "@/lib/utils/format";
import type { LoanStats } from "@/lib/domain/loan";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function LoanSection({
  td,
  intlLocale,
  loanStats,
  loanAmountCents,
  loanTaeg,
  loanDurationMonths,
  loanDeferralMonths,
  loanStartDate,
  insuranceMonthlyCents,
}: {
  td: T;
  intlLocale: string;
  loanStats: LoanStats;
  loanAmountCents: bigint;
  loanTaeg: number;
  loanDurationMonths: number;
  loanDeferralMonths: number | null;
  loanStartDate: Date;
  insuranceMonthlyCents: bigint | null;
}) {
  const insurance = insuranceMonthlyCents ?? BigInt(0);
  const deferralMonths = loanDeferralMonths ?? 0;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 space-y-6">
      {/* KPIs principaux */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 text-sm">
        <div>
          <p className="text-[var(--muted)] text-xs mb-1">{td("loanDetail.amountBorrowed")}</p>
          <p className="tabular-nums font-semibold text-[var(--foreground)]">
            {formatCurrency(loanAmountCents, 0)}
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
            {loanTaeg.toFixed(2)} %
          </p>
        </div>
        <div>
          <p className="text-[var(--muted)] text-xs mb-1">{td("loanDetail.projectedEnd")}</p>
          <p className="tabular-nums font-semibold text-[var(--foreground)]">
            {new Intl.DateTimeFormat(intlLocale, { month: "short", year: "numeric" }).format(loanStats.endDate)}
          </p>
        </div>
      </div>

      {/* Mensualités */}
      <div className="border-t border-[var(--border)] pt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
        {deferralMonths > 0 && (
          <div>
            <p className="text-[var(--muted)] text-xs mb-1">
              {td("loanDetail.monthlyDuring", { months: deferralMonths })}
            </p>
            <p className="tabular-nums font-semibold text-[var(--foreground)]">
              {formatCurrency(loanStats.deferralPaymentCents + insurance)}
              <span className="text-xs text-[var(--muted)] font-normal ml-1">{td("loanDetail.perMonth")}</span>
            </p>
            <p className="text-xs text-[var(--muted)]">{td("loanDetail.interestOnly")}{insurance > BigInt(0) ? td("loanDetail.plusInsurance") : ""}</p>
          </div>
        )}
        <div>
          <p className="text-[var(--muted)] text-xs mb-1">
            {deferralMonths > 0 ? td("loanDetail.monthlyAfterDeferred") : td("loanDetail.monthly")}
          </p>
          <p className="tabular-nums font-semibold text-[var(--foreground)]">
            {formatCurrency(loanStats.amortPaymentCents + insurance)}
            <span className="text-xs text-[var(--muted)] font-normal ml-1">{td("loanDetail.perMonth")}</span>
          </p>
          {insurance > BigInt(0) && (
            <p className="text-xs text-[var(--muted)]">
              {td("loanDetail.insuranceAmount", { amount: formatCurrency(insurance) })}
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
        {insurance > BigInt(0) && (
          <div>
            <p className="text-[var(--muted)] text-xs mb-1">{td("loanDetail.totalInsurance")}</p>
            <p className="tabular-nums font-semibold text-[var(--negative)]">
              {formatCurrency(insurance * BigInt(loanDurationMonths), 0)}
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
            {td("loanDetail.repaymentProgress", { elapsed: loanStats.monthsElapsed, total: loanDurationMonths })}
          </span>
          <span>{loanStats.progressPct}%</span>
        </div>
        <div
          className="h-2 bg-[var(--surface-elevated)] rounded-full overflow-hidden"
          role="progressbar"
          aria-valuenow={loanStats.progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${td("loanDetail.repaymentProgress", { elapsed: loanStats.monthsElapsed, total: loanDurationMonths })}: ${loanStats.progressPct}%`}
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
            {new Intl.DateTimeFormat(intlLocale, { month: "short", year: "numeric" }).format(loanStartDate)}
          </span>
          <span>
            {new Intl.DateTimeFormat(intlLocale, { month: "short", year: "numeric" }).format(loanStats.endDate)}
          </span>
        </div>
      </div>
    </div>
  );
}
