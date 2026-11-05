import { getTranslations } from "next-intl/server";
import { formatCurrency } from "@/lib/utils/format";

/**
 * The company page's three figures: its net asset value (after current
 * accounts), the viewer's share of it (after the discount, plus their own
 * current account), and the value of one part (before and after the discount).
 */
export async function CompanyKpis({
  discountPct,
  anrCents,
  currentAccountsCents,
  corporateTaxCents,
  partsHeld,
  viewerWeight,
  shareCents,
  ownCurrentAccountCents,
  partValueCents,
  discountedPartValueCents,
}: Readonly<{
  discountPct: number | null;
  anrCents: bigint;
  currentAccountsCents: bigint;
  /** Under IS, the corporate tax on the latent gain, already out of anrCents. */
  corporateTaxCents: bigint;
  partsHeld: number;
  /** The viewer's economic weight, 0-1 - what the share's percentage shows. */
  viewerWeight: number;
  shareCents: bigint;
  ownCurrentAccountCents: bigint;
  partValueCents: bigint;
  discountedPartValueCents: bigint | null;
}>) {
  const t = await getTranslations("companies");
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
        <p className="text-xs text-[var(--muted)]">{t("page.anr")}</p>
        <p className="text-2xl font-semibold tabular-nums text-[var(--accent)] mt-1 amount">{formatCurrency(anrCents, 0)}</p>
        {corporateTaxCents > BigInt(0) && (
          <p className="text-xs text-[var(--muted)] mt-1 amount">
            {t("page.afterCorporateTax", { amount: formatCurrency(corporateTaxCents, 0) })}
          </p>
        )}
        {currentAccountsCents > BigInt(0) && (
          <p className="text-xs text-[var(--muted)] mt-1 amount">
            {t("page.afterCurrentAccounts", { amount: formatCurrency(currentAccountsCents, 0) })}
          </p>
        )}
      </div>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
        {partsHeld > 0 ? (
          <>
            <p className="text-xs text-[var(--muted)]">{t("page.yourShareLabel", { pct: Math.round(viewerWeight * 1000) / 10 })}</p>
            <p className="text-2xl font-semibold tabular-nums text-[var(--foreground)] mt-1 amount">{formatCurrency(shareCents, 0)}</p>
            <p className="text-xs text-[var(--muted)] mt-1">{t("page.yourShareHint")}</p>
            {ownCurrentAccountCents > BigInt(0) && (
              <p className="text-xs text-[var(--muted)] mt-0.5 amount">
                {t("page.plusYourCurrentAccount", { amount: formatCurrency(ownCurrentAccountCents, 0) })}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-[var(--muted)]">{t("page.noShare")}</p>
        )}
      </div>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
        <p className="text-xs text-[var(--muted)]">{t("page.partValue")}</p>
        <p className="text-2xl font-semibold tabular-nums text-[var(--foreground)] mt-1 amount">{formatCurrency(partValueCents, 2)}</p>
        {discountedPartValueCents !== null && discountPct && (
          <p className="text-xs text-[var(--muted)] mt-1 amount">
            {t("page.afterDiscount", {
              pct: Math.round(discountPct * 1000) / 10,
              amount: formatCurrency(discountedPartValueCents, 2),
            })}
          </p>
        )}
      </div>
    </div>
  );
}
