import Link from "next/link";
import { updateInvestmentStartDate, updateAccountTaxTreatment } from "@/lib/actions/accounts";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function InvestmentFormsSection({
  td,
  accountId,
  investmentStartDate,
  taxTreatment,
  taxRatePct,
}: Readonly<{
  td: T;
  accountId: string;
  investmentStartDate: Date | null;
  taxTreatment: string;
  taxRatePct: number | null;
}>) {
  return (
    <>
      {/* Date de début d'investissement */}
      <div className="border-t border-[var(--border)] px-6 py-4">
        <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-3">
          {td("investmentStartDate")}
        </p>
        <form action={updateInvestmentStartDate} className="flex items-center gap-3">
          <input type="hidden" name="id" value={accountId} />
          <input
            type="date"
            name="investmentStartDate"
            defaultValue={
              investmentStartDate
                ? investmentStartDate.toISOString().slice(0, 10)
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
          {investmentStartDate && (
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
          <input type="hidden" name="id" value={accountId} />
          <select
            name="taxTreatment"
            defaultValue={taxTreatment}
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
            defaultValue={taxRatePct != null ? (taxRatePct * 100).toFixed(1) : ""}
            className="w-24 text-sm bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 transition-colors"
          />
          <button
            type="submit"
            className="text-xs px-3 py-2 rounded-lg bg-[var(--accent)]/15 text-[var(--accent-text)] hover:bg-[var(--accent)]/25 active:scale-[0.97] transition cursor-pointer font-medium min-h-[44px]"
          >
            {td("fiscalSummary.save")}
          </button>
        </form>
        <Link
          href="/tax-report"
          className="text-xs text-[var(--accent-text)] hover:underline underline-offset-2 inline-block mt-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
        >
          {td("fiscalSummary.taxReportLink")}
        </Link>
      </div>
    </>
  );
}
