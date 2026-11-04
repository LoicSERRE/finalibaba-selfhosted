"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils/format";
import { partsPct } from "@/lib/domain/company";
import { respondToCompanyLink } from "@/lib/actions/companies";

/** Plain numbers: BigInt never crosses the RSC boundary. */
export type CompanyCardData = {
  id: string;
  name: string;
  role: "manager" | "associate";
  partsHeld: number;
  totalParts: number;
  valueCents: number;
  shareCents: number;
};

export type PendingCompanyLinkData = {
  associateId: string;
  companyName: string;
  from: string | null;
  parts: number;
  totalParts: number;
};

/**
 * The companies on the Accounts page (dev-docs/companies.md, interface "C"):
 * a company is one of the person's assets, so it sits where the others are -
 * one card each, its value and the share held. A link a manager made shows
 * here too, and counts for nothing until accepted.
 */
export function CompaniesSection({
  cards,
  pending,
}: Readonly<{ cards: CompanyCardData[]; pending: PendingCompanyLinkData[] }>) {
  const t = useTranslations("companies");
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  if (cards.length === 0 && pending.length === 0) return null;

  async function respond(associateId: string, accept: boolean) {
    setBusy(associateId);
    try {
      await respondToCompanyLink(associateId, accept);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="companies-title">
      <h2 id="companies-title" className="text-sm font-medium text-[var(--muted)]">{t("sectionTitle")}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {cards.map((c) => (
          <Link
            key={c.id}
            href={`/companies/${c.id}`}
            className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex items-center justify-between gap-3 hover:bg-[var(--surface-elevated)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--foreground)] break-words">
                {c.name}
                <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                  {c.role === "manager" ? t("roleManager") : t("roleAssociate")}
                </span>
              </p>
              <p className="text-xs text-[var(--muted)] mt-1">
                {t.rich(c.partsHeld > 0 ? "cardSummary" : "cardManagerOnly", {
                  amount: (chunks) => <span className="amount">{chunks}</span>,
                  pct: partsPct(c.partsHeld, c.totalParts),
                  value: formatCurrency(c.valueCents, 0),
                })}
              </p>
            </div>
            {c.partsHeld > 0 && (
              <div className="text-right shrink-0">
                <p className="text-lg font-semibold tabular-nums text-[var(--foreground)] amount">{formatCurrency(c.shareCents, 0)}</p>
                <p className="text-xs text-[var(--muted)]">{t("yourShare")}</p>
              </div>
            )}
          </Link>
        ))}
        {pending.map((p) => (
          <div
            key={p.associateId}
            className="bg-[var(--surface)] border border-[var(--warning)]/40 rounded-xl p-4 space-y-3 sm:col-span-2"
          >
            <p className="text-sm text-[var(--foreground)]">
              {t("invitation", { from: p.from ?? "?", company: p.companyName, pct: partsPct(p.parts, p.totalParts) })}
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => respond(p.associateId, false)}>
                <X size={14} aria-hidden="true" />
                {t("decline")}
              </Button>
              <Button size="sm" disabled={busy !== null} onClick={() => respond(p.associateId, true)}>
                <Check size={14} aria-hidden="true" />
                {t("accept")}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
