import { formatCurrency } from "@/lib/utils/format";
import { ImportBalanceHistoryDialog } from "@/components/account-detail/import-balance-history-dialog";
import { ImportTransactionsDialog } from "@/components/account-detail/import-transactions-dialog";
import type { HistoryRow } from "@/lib/domain/account-detail";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function BalanceHistoryTable({
  td,
  intlLocale,
  accountId,
  historyRows,
  canImportCsv,
  existingBalanceDates,
  existingFingerprints,
}: Readonly<{
  td: T;
  intlLocale: string;
  accountId: string;
  historyRows: HistoryRow[];
  canImportCsv: boolean;
  existingBalanceDates: string[];
  existingFingerprints: string[];
}>) {
  if (historyRows.length === 0) return null;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
        <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
          {td("history", { count: historyRows.length, suffix: historyRows.length !== 1 ? "s" : "" })}
        </h2>
        {canImportCsv && (
          <div className="flex items-center gap-2">
            <ImportBalanceHistoryDialog accountId={accountId} existingDates={existingBalanceDates} />
            <ImportTransactionsDialog accountId={accountId} existingFingerprints={existingFingerprints} />
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
                {new Intl.DateTimeFormat(intlLocale, {
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
  );
}
