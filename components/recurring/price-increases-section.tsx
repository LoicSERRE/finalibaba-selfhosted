import { TrendingUp } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { formatCurrency, formatDateShort } from "@/lib/utils/format";
import type { PriceIncrease } from "@/lib/domain/price-changes";
import { AcceptPriceButton } from "@/components/recurring/accept-price-button";

export type PriceIncreaseRow = { id: string; label: string; accountName: string; increase: PriceIncrease };

type Props = {
  readonly rows: readonly PriceIncreaseRow[];
  readonly intlLocale: string;
};

/**
 * Recurring expenses charged at a higher price than their template (v2.20):
 * what it was, what it is, what it costs a year - and one click to make the
 * new price the template's, which also clears the row.
 */
export async function PriceIncreasesSection({ rows, intlLocale }: Props) {
  if (rows.length === 0) return null;
  const t = await getTranslations("recurring.priceIncreases");
  const yearlyTotal = rows.reduce((sum, r) => sum + r.increase.yearlyExtraCents, BigInt(0));

  return (
    <section className="space-y-3" aria-labelledby="price-increases-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="price-increases-title" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider flex items-center gap-1.5">
          <TrendingUp size={12} aria-hidden="true" />
          {t("title")}
        </h2>
        <span className="text-sm text-[var(--muted)]">
          {t("yearlyTotal")} <span className="amount font-medium text-[var(--negative)] tabular-nums">+{formatCurrency(yearlyTotal)}</span>
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--foreground)] break-words">{r.label}</p>
            <p className="text-sm tabular-nums mt-0.5">
              <span className="amount text-[var(--muted)] line-through">{formatCurrency(-r.increase.fromCents)}</span>
              {" → "}
              <span className="amount font-medium text-[var(--foreground)]">{formatCurrency(-r.increase.toCents)}</span>
              <span className="text-[var(--muted)]">
                {" · "}
                <span className="amount text-[var(--negative)]">+{formatCurrency(r.increase.yearlyExtraCents)}</span> {t("perYear")}
              </span>
            </p>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {t("since", { date: formatDateShort(r.increase.date, intlLocale), account: r.accountName })}
            </p>
          </div>
          <AcceptPriceButton id={r.id} label={r.label} />
        </div>
      ))}
    </section>
  );
}
