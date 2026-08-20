import type { getTranslations } from "next-intl/server";
import { formatCurrency } from "@/lib/utils/format";
import type { SharedHoldingAccountGroup } from "@/lib/domain/share-links";

type T = Awaited<ReturnType<typeof getTranslations>>;

// Only rendered by app/shared/[token]/page.tsx when the link's own
// includeHoldings flag is set - see the ShareLink schema comment and
// lib/domain/share-links.ts's buildSharedHoldings for why cost basis/gain
// are deliberately left out of this view.
export function SharedHoldingsSection({
  t,
  groups,
}: Readonly<{ t: T; groups: SharedHoldingAccountGroup[] }>) {
  if (groups.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
        {t("shared.holdingsTitle")}
      </h2>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
        {groups.map((group) => (
          <div key={group.accountId} className="px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-[var(--foreground)]">{group.accountName}</p>
              <p className="text-sm font-semibold tabular-nums text-[var(--foreground)]">
                {formatCurrency(group.totalCents, 0)}
              </p>
            </div>
            <div className="space-y-0.5">
              {group.holdings.map((holding) => (
                <div
                  key={holding.id}
                  className="flex items-center justify-between text-xs min-h-[44px] -mx-2 px-2"
                >
                  <span className="text-[var(--muted)]">
                    {holding.ticker}
                    <span className="opacity-70"> · {holding.quantity}</span>
                  </span>
                  <span className="tabular-nums text-[var(--foreground)]">
                    {formatCurrency(holding.valueCents, 0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
