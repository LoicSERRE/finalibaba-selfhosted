"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { partsPct } from "@/lib/domain/company";
import { respondToCompanyLink } from "@/lib/actions/companies";
import type { PendingCompanyLinkData } from "@/components/companies/companies-section";

/**
 * A link to the viewer a manager made, waiting for an answer. Nothing about
 * the company reaches the viewer's figures until they accept it
 * (respondToCompanyLink); answering refreshes the page.
 */
export function PendingInvitation({ link }: Readonly<{ link: PendingCompanyLinkData }>) {
  const t = useTranslations("companies");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function respond(accept: boolean) {
    setBusy(true);
    try {
      await respondToCompanyLink(link.associateId, accept);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-[var(--surface)] border border-[var(--warning)]/40 rounded-xl p-4 space-y-3 sm:col-span-2">
      <p className="text-sm text-[var(--foreground)]">
        {t("invitation", { from: link.from ?? "?", company: link.companyName, pct: partsPct(link.parts, link.totalParts) })}
      </p>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => respond(false)}>
          <X size={14} aria-hidden="true" />
          {t("decline")}
        </Button>
        <Button size="sm" disabled={busy} onClick={() => respond(true)}>
          <Check size={14} aria-hidden="true" />
          {t("accept")}
        </Button>
      </div>
    </div>
  );
}
