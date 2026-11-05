"use client";

import { useTranslations } from "next-intl";
import { CompanyCard } from "@/components/companies/company-card";
import { PendingInvitation } from "@/components/companies/pending-invitation";
import { ViewingCompanyBanner } from "@/components/companies/company-view-actions";

/** Plain numbers: BigInt never crosses the RSC boundary. */
export type CompanyCardData = {
  id: string;
  name: string;
  role: "manager" | "associate";
  partsHeld: number;
  totalParts: number;
  weight: number;
  valueCents: number;
  shareCents: number;
  currentAccountCents: number;
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
 *
 * One component per file under components/companies: lizard (the CI
 * complexity gate) loses track of a component that follows another with
 * nested handlers, and then cannot measure either.
 */
export function CompaniesSection({
  cards,
  pending,
  scopedName,
  readOnly,
}: Readonly<{
  cards: CompanyCardData[];
  pending: PendingCompanyLinkData[];
  /** Set in a company's scope: the banner saying so, instead of the cards. */
  scopedName: string | null;
  readOnly: boolean;
}>) {
  const t = useTranslations("companies");
  if (scopedName) return <ViewingCompanyBanner name={scopedName} readOnly={readOnly} />;
  if (cards.length === 0 && pending.length === 0) return null;

  return (
    <section className="space-y-3" aria-labelledby="companies-title">
      <h2 id="companies-title" className="text-sm font-medium text-[var(--muted)]">{t("sectionTitle")}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {cards.map((c) => (
          <CompanyCard key={c.id} card={c} />
        ))}
        {pending.map((p) => (
          <PendingInvitation key={p.associateId} link={p} />
        ))}
      </div>
    </section>
  );
}
