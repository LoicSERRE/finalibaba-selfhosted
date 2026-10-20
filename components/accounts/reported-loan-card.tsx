import Link from "next/link";
import { formatCurrency } from "@/lib/utils/format";
import { InstitutionLogo } from "@/components/shared/institution-logo";
import type { ReportedLoan } from "@/lib/domain/accounts-page";
import type { LoanTermsValues } from "@/lib/domain/loan-terms";
import { EditLoanTermsDialog } from "@/components/accounts/edit-loan-terms-dialog";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

// Per-field readonly: a Readonly<{...}> props type hides the component from
// lizard (scripts/lizard-blind-spots.py).
type Props = {
  readonly t: T;
  readonly td: T;
  readonly intlLocale: string;
  readonly loan: {
    readonly id: string;
    readonly name: string;
    readonly institutionName: string | null;
    readonly institutionLogoUrl: string | null;
    readonly reported: ReportedLoan;
    readonly termsValues: LoanTermsValues;
  };
  /** A granted (read-only) portfolio: no edit button. */
  readonly readOnly?: boolean;
};

/**
 * A loan its bank reports (v2.19.1), on the Crédits tab: the bank's own
 * remaining capital, next instalment and end date, rather than a schedule
 * re-amortised from parameters nobody typed in. Anything the bank does not
 * give is left out, never estimated.
 */
export function ReportedLoanCard({ t, td, intlLocale, loan, readOnly }: Props) {
  const { reported } = loan;
  const estimates = reported.estimates;
  const monthYear = new Intl.DateTimeFormat(intlLocale, { month: "short", year: "numeric" });
  const day = new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="relative bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 space-y-4 hover:border-[var(--accent)]/40 hover:bg-[var(--surface-elevated)] transition">
      <Link
        href={`/accounts/${loan.id}`}
        aria-label={`Voir ${loan.name}`}
        className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset"
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {loan.institutionName && (
            <div className="flex items-center gap-1.5 mb-0.5">
              <InstitutionLogo name={loan.institutionName} logoUrl={loan.institutionLogoUrl} size={24} />
              <p className="text-xs text-[var(--muted)]">{loan.institutionName}</p>
            </div>
          )}
          <p className="font-medium text-[var(--foreground)] break-words">{loan.name}</p>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            {reported.ratePct !== null && `${td("loanDetail.taeg")} ${reported.ratePct.toFixed(2)}% · `}
            {t("loan.reportedByBank")}
          </p>
          {reported.inDeferral && (
            <span className="inline-block mt-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--surface-elevated)] border border-[var(--border)] text-[var(--foreground)]">
              {estimates?.deferralEnd
                ? t("loan.inDeferralUntil", { date: monthYear.format(estimates.deferralEnd) })
                : t("loan.inDeferral")}
            </span>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-semibold tabular-nums text-[var(--negative)] amount">
            {formatCurrency(reported.remainingCents, 0)}
          </p>
          <p className="text-xs text-[var(--muted)]">{t("loan.remaining")}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4 text-sm">
        {reported.borrowedCents !== null && (
          <div>
            <p className="text-[var(--muted)] text-xs mb-1">{t("loan.amountBorrowed")}</p>
            <p className="tabular-nums font-medium text-[var(--foreground)] amount">{formatCurrency(reported.borrowedCents, 0)}</p>
          </div>
        )}
        {reported.nextPaymentCents !== null && (
          <div>
            <p className="text-[var(--muted)] text-xs mb-1">{t("loan.nextPayment")}</p>
            <p className="tabular-nums font-medium text-[var(--foreground)] amount">
              {formatCurrency(reported.nextPaymentCents)}
              {reported.nextPaymentDate && (
                <span className="text-xs text-[var(--muted)] font-normal"> · {day.format(reported.nextPaymentDate)}</span>
              )}
            </p>
          </div>
        )}
        {reported.endDate && (
          <div>
            <p className="text-[var(--muted)] text-xs mb-1">{t("loan.end")}</p>
            <p className="tabular-nums font-medium text-[var(--foreground)]">{monthYear.format(reported.endDate)}</p>
          </div>
        )}
      </div>

      {estimates && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4 text-sm border-t border-[var(--border)] pt-3">
          <div>
            <p className="text-[var(--muted)] text-xs mb-1">
              {estimates.deferralMonths > 0 ? t("loan.estimatedMonthlyAfterDeferral") : t("loan.estimatedMonthly")}
            </p>
            <p className="tabular-nums font-medium text-[var(--foreground)] amount">{formatCurrency(estimates.monthlyAfterDeferralCents)}</p>
          </div>
          <div>
            <p className="text-[var(--muted)] text-xs mb-1">{t("loan.estimatedTotalCost")}</p>
            <p className="tabular-nums font-medium text-[var(--negative)] amount">{formatCurrency(estimates.totalCostCents, 0)}</p>
          </div>
          <div>
            <p className="text-[var(--muted)] text-xs mb-1">{t("loan.duration")}</p>
            <p className="tabular-nums font-medium text-[var(--foreground)]">
              {t("loan.durationValue", { months: estimates.durationMonths })}
              {estimates.deferralMonths > 0 && (
                <span className="text-xs text-[var(--muted)] font-normal"> · {t("loan.deferred", { months: estimates.deferralMonths })}</span>
              )}
            </p>
          </div>
        </div>
      )}

      {!readOnly && (
        <div className="relative z-10 flex items-center justify-between gap-2">
          <p className="text-xs text-[var(--muted)]">{estimates ? t("loan.estimatesNote") : t("loan.completeTermsHint")}</p>
          <EditLoanTermsDialog accountId={loan.id} values={loan.termsValues} bankReported />
        </div>
      )}

      {reported.repaidPct !== null && (
        <div>
          <div className="flex justify-between text-xs text-[var(--muted)] mb-1.5">
            <span>{t("loan.repaidShare")}</span>
            <span>{reported.repaidPct}%</span>
          </div>
          <div className="h-1.5 bg-[var(--surface-elevated)] rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${reported.repaidPct}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
