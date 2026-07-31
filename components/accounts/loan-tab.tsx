import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import { InstitutionLogo } from "@/components/institution-logo";
import { AddLoanDialog } from "@/components/add-loan-dialog";
import { DeleteAccountButton } from "@/components/delete-account-button";
import type { LoanRow } from "@/lib/accounts-page";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function LoanTab({
  t,
  td,
  intlLocale,
  institutions,
  rows,
}: {
  t: T;
  td: T;
  intlLocale: string;
  institutions: { id: string; name: string }[];
  rows: LoanRow[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AddLoanDialog institutions={institutions} />
      </div>
      {rows.length === 0 ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-10 text-center text-sm text-[var(--muted)]">
          {t("noLoan")}
        </div>
      ) : (
        rows.map((loan) => {
          if (!loan.hasParams) {
            return (
              <div key={loan.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 flex items-center justify-between">
                <div>
                  <p className="font-medium text-[var(--foreground)]">{loan.name}</p>
                  <p className="text-xs text-[var(--muted)] mt-1">{t("loan.incompleteParams")}</p>
                </div>
                <DeleteAccountButton id={loan.id} name={loan.name} backHref="/accounts?tab=credits" />
              </div>
            );
          }

          const { stats } = loan;
          const progressColor =
            stats.progressPct > 75 ? "bg-[var(--positive)]" : stats.progressPct > 40 ? "bg-[var(--accent)]" : "bg-[var(--negative)]";

          return (
            <div
              key={loan.id}
              className="relative bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 space-y-4 hover:border-[var(--accent)]/40 hover:bg-[var(--surface-elevated)] active:scale-[0.98] active:opacity-90 transition cursor-pointer"
            >
              <Link
                href={`/accounts/${loan.id}`}
                aria-label={`Voir ${loan.name}`}
                className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset"
              />
              <div className="flex items-start justify-between">
                <div>
                  {loan.institutionName && (
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <InstitutionLogo name={loan.institutionName} logoUrl={loan.institutionLogoUrl} size={24} />
                      <p className="text-xs text-[var(--muted)]">{loan.institutionName}</p>
                    </div>
                  )}
                  <p className="font-medium text-[var(--foreground)]">{loan.name}</p>
                  <p className="text-xs text-[var(--muted)] mt-0.5">
                    {td("loanDetail.taeg")} {loan.taeg.toFixed(2)}% · {loan.durationMonths} mois
                    {loan.deferralMonths > 0 && ` · ${t("loan.deferred", { months: loan.deferralMonths })}`}
                  </p>
                </div>
                <div className="relative z-10 flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums text-[var(--negative)]">
                      {formatCurrency(stats.currentCapitalCents, 0)}
                    </p>
                    <p className="text-xs text-[var(--muted)]">{t("loan.remaining")}</p>
                  </div>
                  <DeleteAccountButton id={loan.id} name={loan.name} backHref="/accounts?tab=credits" />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 text-sm">
                <div>
                  <p className="text-[var(--muted)] text-xs mb-1">{t("loan.amountBorrowed")}</p>
                  <p className="tabular-nums font-medium text-[var(--foreground)]">
                    {formatCurrency(loan.amountBorrowedCents, 0)}
                  </p>
                </div>
                <div>
                  <p className="text-[var(--muted)] text-xs mb-1">{t("loan.currentPayment")}</p>
                  <p className="tabular-nums font-medium text-[var(--foreground)]">
                    {formatCurrency(stats.currentMonthlyTotalCents)}
                    {loan.insuranceMonthlyCents > BigInt(0) && (
                      <span className="text-xs text-[var(--muted)] font-normal"> ({t("loan.insuranceIncl")})</span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-[var(--muted)] text-xs mb-1">{t("loan.totalCost")}</p>
                  <p className="tabular-nums font-medium text-[var(--negative)]">{formatCurrency(stats.totalCostCents, 0)}</p>
                </div>
                <div>
                  <p className="text-[var(--muted)] text-xs mb-1">{t("loan.projectedEnd")}</p>
                  <p className="tabular-nums font-medium text-[var(--foreground)]">
                    {new Intl.DateTimeFormat(intlLocale, { month: "short", year: "numeric" }).format(stats.endDate)}
                  </p>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs text-[var(--muted)] mb-1.5">
                  <span>{t("loan.repaymentProgress", { elapsed: stats.monthsElapsed, total: loan.durationMonths })}</span>
                  <span>{stats.progressPct}%</span>
                </div>
                <div className="h-1.5 bg-[var(--surface-elevated)] rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${progressColor}`} style={{ width: `${stats.progressPct}%` }} />
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
