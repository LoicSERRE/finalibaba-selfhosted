"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { respondToCoOwnership, respondToPortfolioGrant } from "@/lib/actions/sharing";

type PendingShares = {
  coOwnerships: { accountId: string; accountName: string; from: string | null }[];
  grants: { grantorUserId: string; from: string | null }[];
};

/**
 * Co-ownerships and portfolio grants other users have offered the viewer.
 * Neither has any effect until accepted here (lib/actions/sharing.ts): sharing
 * used to be imposed, so one member could put an account into another's net
 * worth just by typing their username. Rendered only when something waits.
 */
export function PendingSharesSection({ pending }: Readonly<{ pending: PendingShares }>) {
  const t = useTranslations("settings.pendingShares");
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function respond(key: string, action: () => Promise<void>) {
    setBusy(key);
    try {
      await action();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const rows = [
    ...pending.coOwnerships.map((c) => ({
      key: `account:${c.accountId}`,
      text: t("coOwnership", { from: c.from ?? "?", account: c.accountName }),
      answer: (accept: boolean) => respondToCoOwnership(c.accountId, accept),
    })),
    ...pending.grants.map((g) => ({
      key: `grant:${g.grantorUserId}`,
      text: t("grant", { from: g.from ?? "?" }),
      answer: (accept: boolean) => respondToPortfolioGrant(g.grantorUserId, accept),
    })),
  ];
  if (rows.length === 0) return null;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-[var(--foreground)]">{t("title")}</h2>
        <p className="text-sm text-[var(--muted)] mt-1">{t("description")}</p>
      </div>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
            <p className="text-sm text-[var(--foreground)] break-words min-w-0 flex-1">{r.text}</p>
            <div className="flex gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => respond(r.key, () => r.answer(false))}
              >
                <X size={14} aria-hidden="true" />
                {t("decline")}
              </Button>
              <Button size="sm" disabled={busy !== null} onClick={() => respond(r.key, () => r.answer(true))}>
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
