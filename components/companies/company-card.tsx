"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/utils/format";
import { partsPct } from "@/lib/domain/company";
import type { CompanyCardData } from "@/components/companies/companies-section";

/** A company on the Accounts page: its net assets and the viewer's share. */
export function CompanyCard({ card }: Readonly<{ card: CompanyCardData }>) {
  const t = useTranslations("companies");
  const holds = card.partsHeld > 0;
  return (
    <Link
      href={`/companies/${card.id}`}
      className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex items-center justify-between gap-3 hover:bg-[var(--surface-elevated)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[var(--foreground)] break-words">
          {card.name}
          <span className="ml-2 text-xs font-normal text-[var(--muted)]">
            {card.role === "manager" ? t("roleManager") : t("roleAssociate")}
          </span>
        </p>
        <p className="text-xs text-[var(--muted)] mt-1">
          {t.rich(holds ? "cardSummary" : "cardManagerOnly", {
            // The figure inside the sentence, marked so discretion mode hides it.
            amount: (chunks) => <span className="amount">{chunks}</span>,
            pct: partsPct(card.partsHeld, card.totalParts),
            value: formatCurrency(card.valueCents, 0),
          })}
        </p>
      </div>
      {holds && (
        <div className="text-right shrink-0">
          <p className="text-lg font-semibold tabular-nums text-[var(--foreground)] amount">{formatCurrency(card.shareCents, 0)}</p>
          <p className="text-xs text-[var(--muted)]">{t("yourShare")}</p>
        </div>
      )}
    </Link>
  );
}
