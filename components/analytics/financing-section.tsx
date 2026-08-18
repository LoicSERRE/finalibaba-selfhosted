import { formatCurrency } from "@/lib/utils/format";
import type { DebtAccountRow } from "@/lib/domain/analytics";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function FinancingSection({
  t,
  debtAccounts,
  totalLiabilities,
  debtRatio,
  grossAssets,
}: Readonly<{
  t: T;
  debtAccounts: DebtAccountRow[];
  totalLiabilities: bigint;
  debtRatio: number;
  grossAssets: bigint;
}>) {
  if (debtAccounts.length === 0) return null;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--border)]">
        <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
          {t("financing.title")}
        </h2>
      </div>
      <div className="px-4 sm:px-6 py-4 border-b border-[var(--border)] flex flex-wrap items-center gap-4 sm:gap-8 text-sm">
        <div>
          <p className="text-xs text-[var(--muted)] mb-1">{t("financing.totalLiabilities")}</p>
          <p className="tabular-nums font-semibold text-[var(--negative)]">
            {formatCurrency(totalLiabilities, 0)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--muted)] mb-1">{t("financing.debtRatio")}</p>
          <p className="tabular-nums font-semibold text-[var(--foreground)]">
            {debtRatio}%
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--muted)] mb-1">{t("financing.equity")}</p>
          <p className="tabular-nums font-semibold text-[var(--positive)]">
            {formatCurrency(grossAssets - totalLiabilities, 0)}
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th scope="col" className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider whitespace-nowrap">{t("financing.colAsset")}</th>
            <th scope="col" className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider whitespace-nowrap">{t("financing.colValue")}</th>
            <th scope="col" className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider whitespace-nowrap">{t("financing.colLoan")}</th>
            <th scope="col" className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider whitespace-nowrap">{t("financing.colEquity")}</th>
            <th scope="col" className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider whitespace-nowrap">{t("financing.colLtv")}</th>
          </tr>
        </thead>
        <tbody>
          {debtAccounts.map((a, i) => (
            <tr
              key={a.id}
              className={`${
                i < debtAccounts.length - 1 ? "border-b border-[var(--border)]" : ""
              } hover:bg-[var(--surface-elevated)] transition-colors`}
            >
              <td className="px-4 sm:px-6 py-3">
                <p className="font-medium text-[var(--foreground)]">{a.name}</p>
                <p className="text-xs text-[var(--muted)]">{a.institution}</p>
              </td>
              <td className="px-4 sm:px-6 py-3 tabular-nums text-[var(--foreground)]">
                {formatCurrency(a.value, 0)}
              </td>
              <td className="px-4 sm:px-6 py-3 tabular-nums text-[var(--negative)]">
                {formatCurrency(a.liability, 0)}
              </td>
              <td className="hidden sm:table-cell px-6 py-3 tabular-nums text-[var(--positive)]">
                {formatCurrency(a.equity, 0)}
              </td>
              <td className="px-4 sm:px-6 py-3">
                <div className="flex items-center gap-2">
                  <div className="w-10 sm:w-16 h-1.5 bg-[var(--surface-elevated)] rounded-full overflow-hidden" aria-hidden="true">
                    <div
                      className={`h-full rounded-full ${
                        a.ltv > 80
                          ? "bg-[var(--negative)]"
                          : a.ltv > 60
                          ? "bg-[var(--warning)]"
                          : "bg-[var(--positive)]"
                      }`}
                      style={{ width: `${Math.min(a.ltv, 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-[var(--muted)] tabular-nums">
                    {a.ltv}%
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
