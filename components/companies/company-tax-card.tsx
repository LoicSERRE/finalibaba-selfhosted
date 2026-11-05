import { getTranslations } from "next-intl/server";
import { formatCurrency } from "@/lib/utils/format";
import { BookValueField } from "@/components/companies/book-value-field";

type Building = { id: string; name: string; valueCents: number; bookValueCents: number | null };

/**
 * The company's tax regime as it weighs on its value (step 4). Under IR it is
 * transparent and there is nothing to deduct at its level; under IS the
 * corporate tax on its latent gain is, and that gain is measured on each
 * building from its net book value, which the manager enters.
 */
export async function CompanyTaxCard({
  regime,
  latentTaxCents,
  taxableGainCents,
  buildings,
  isManager,
}: Readonly<{
  regime: "IR" | "IS";
  latentTaxCents: bigint;
  taxableGainCents: bigint | null;
  buildings: Building[];
  isManager: boolean;
}>) {
  const t = await getTranslations("companies.tax");

  return (
    <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3" aria-labelledby="company-tax">
      <h2 id="company-tax" className="text-sm font-medium text-[var(--foreground)]">{t("title")}</h2>
      {regime === "IR" ? (
        <p className="text-sm text-[var(--muted)]">{t("irBody")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-[var(--muted)]">{t("isLatentTax")}</p>
            <p className="text-lg font-semibold tabular-nums text-[var(--negative-text)] amount">{formatCurrency(latentTaxCents, 0)}</p>
          </div>
          <p className="text-xs text-[var(--muted)] amount">{t("isOnGain", { amount: formatCurrency(taxableGainCents ?? BigInt(0), 0) })}</p>
          <p className="text-xs text-[var(--muted)]">{t("isScale")}</p>
          {buildings.length > 0 && (
            <ul className="divide-y divide-[var(--border)]">
              {buildings.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0 break-words text-[var(--foreground)]">
                    {b.name}
                    <span className="block text-xs text-[var(--muted)] amount">
                      {b.bookValueCents === null
                        ? t("noBookValue", { value: formatCurrency(b.valueCents, 0) })
                        : t("buildingGain", {
                            value: formatCurrency(b.valueCents, 0),
                            book: formatCurrency(b.bookValueCents, 0),
                            gain: formatCurrency(b.valueCents - b.bookValueCents, 0),
                          })}
                    </span>
                  </span>
                  {isManager && <BookValueField accountId={b.id} name={b.name} bookValueCents={b.bookValueCents} />}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
