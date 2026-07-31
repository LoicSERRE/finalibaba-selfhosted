import Link from "next/link";
import { formatCurrency } from "@/lib/utils/format";
import { InstitutionLogo } from "@/components/shared/institution-logo";
import type { InvestAccountRow } from "@/lib/domain/accounts-page";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function InvestmentTab({ t, ta, rows }: { t: T; ta: T; rows: InvestAccountRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-10 text-center text-sm text-[var(--muted)]">
        {t("noAccount")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {rows.map((account) => (
        <div
          key={account.id}
          className="relative bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden hover:border-[var(--accent)]/40 transition"
        >
          {/* Full-card link to the account detail page - same pattern as the
              real estate/auto/loan cards. z-0 + relative content below it
              (default z-auto stacking) keeps the holdings table's own text
              selectable/readable above the link. */}
          <Link
            href={`/accounts/${account.id}`}
            aria-label={`Voir ${account.name}`}
            className="absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset"
          />
          <div className="px-4 sm:px-6 py-4 border-b border-[var(--border)] flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                {account.institutionName && (
                  <InstitutionLogo name={account.institutionName} logoUrl={account.institutionLogoUrl} size={24} />
                )}
                <p className="text-xs text-[var(--muted)] truncate">
                  {account.institutionName && `${account.institutionName} · `}
                  {ta(account.type as Parameters<typeof ta>[0])}
                  {account.investmentSubtype && ` · ${account.investmentSubtype}`}
                </p>
              </div>
              <p className="font-medium text-[var(--foreground)] truncate">{account.name}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-base font-semibold tabular-nums text-[var(--foreground)]">
                {formatCurrency(account.totalCents, 0)}
              </p>
              {account.hasCostBasis && (
                <p
                  className={`text-xs tabular-nums ${
                    account.gainCents >= BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"
                  }`}
                >
                  {account.gainCents >= BigInt(0) ? "+" : ""}
                  {formatCurrency(account.gainCents, 0)}
                  {account.taxCents > BigInt(0) && (
                    <span className="text-[var(--muted)] hidden sm:inline">
                      {" "}
                      · -{formatCurrency(account.taxCents, 0)} {t("taxes")}
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>

          {account.holdings.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-[var(--muted)]">{t("noHoldings")}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                      {t("table.asset")}
                    </th>
                    <th scope="col" className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                      {t("table.qty")}
                    </th>
                    <th scope="col" className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                      {t("table.price")}
                    </th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                      {t("table.value")}
                    </th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                      {t("table.gain")}
                    </th>
                    {account.hasTaxRate && (
                      <th scope="col" className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                        {t("table.tax")}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {account.holdings.map((h, i) => (
                    <tr
                      key={h.id}
                      className={`${
                        i < account.holdings.length - 1 ? "border-b border-[var(--border)]" : ""
                      } hover:bg-[var(--surface-elevated)] transition-colors`}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-[var(--foreground)]">{h.name || h.ticker}</p>
                        <p className="text-xs text-[var(--muted)]">{h.ticker}</p>
                      </td>
                      <td className="hidden sm:table-cell px-4 py-3 tabular-nums text-[var(--foreground)]">
                        {h.quantityDisplay}
                      </td>
                      <td className="hidden sm:table-cell px-4 py-3 tabular-nums text-[var(--foreground)]">
                        {formatCurrency(h.lastPriceCents)}
                      </td>
                      <td className="px-4 py-3">
                        <p className="tabular-nums font-medium text-[var(--foreground)]">{formatCurrency(h.valueCents)}</p>
                        <p className="text-xs text-[var(--muted)]">{h.pct}%</p>
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {h.gainCents === null ? (
                          <span className="text-[var(--muted)] text-xs">-</span>
                        ) : (
                          <div>
                            <p className={`font-medium ${h.gainCents >= BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                              {h.gainCents >= BigInt(0) ? "+" : ""}
                              {formatCurrency(h.gainCents)}
                            </p>
                            {h.gainPct !== null && (
                              <p className={`text-xs ${h.gainPct >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                                {h.gainPct >= 0 ? "+" : ""}
                                {h.gainPct.toFixed(1)}%
                              </p>
                            )}
                          </div>
                        )}
                      </td>
                      {account.hasTaxRate && (
                        <td className="hidden sm:table-cell px-4 py-3 tabular-nums">
                          {h.taxCents === null ? (
                            <span className="text-[var(--muted)] text-xs">-</span>
                          ) : h.taxCents === BigInt(0) ? (
                            <span className="text-[var(--muted)] text-xs">0,00 €</span>
                          ) : (
                            <p className="text-[var(--negative)] font-medium">-{formatCurrency(h.taxCents)}</p>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
