import Decimal from "decimal.js";
import { formatCurrency } from "@/lib/utils/format";
import { AddHoldingDialog } from "@/components/account-detail/add-holding-dialog";
import { SellHoldingDialog } from "@/components/account-detail/sell-holding-dialog";
import type { HoldingWithTax } from "@/lib/domain/account-detail";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function HoldingsTable({
  td,
  t,
  accountId,
  accountName,
  holdingsWithTax,
  isSynced,
}: {
  td: T;
  t: T;
  accountId: string;
  accountName: string;
  holdingsWithTax: HoldingWithTax[];
  isSynced: boolean;
}) {
  return (
    <>
      <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
        <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
          {td("positions", { count: holdingsWithTax.length, suffix: holdingsWithTax.length !== 1 ? "s" : "" })}
        </h2>
      </div>
      {holdingsWithTax.length === 0 ? (
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
                  <p className="text-xs text-[var(--muted)] mt-0.5">
                    {h.ticker}
                    {h.currency !== "EUR" && ` · ${h.currency}`}
                  </p>
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
                      {/* quantity is a Prisma Decimal - not a plain object, so it
                          can't cross the Server->Client boundary raw (same rule as
                          BigInt, see export-accounts-button.tsx) - stringify it here. */}
                      <SellHoldingDialog accountId={accountId} holding={{ ...h, quantity: h.quantity.toString() }} />
                      <AddHoldingDialog
                        accountId={accountId}
                        accountName={accountName}
                        existing={{ ...h, quantity: h.quantity.toString() }}
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
    </>
  );
}
