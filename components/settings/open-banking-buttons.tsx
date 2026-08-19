"use client";

import { useTransition } from "react";
import { RefreshCw, Link, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncGocardlessAccount } from "@/lib/actions/gocardless";
import { clearGocardlessConnection } from "@/lib/actions/institutions";
import { useTranslations } from "next-intl";

export function ConnectOpenBankingButton({ institutionId }: Readonly<{ institutionId: string }>) {
  const t = useTranslations("openBanking");
  return (
    <a
      href={`/api/gocardless/connect?institutionId=${institutionId}`}
      className="flex items-center gap-1.5 text-xs px-3 py-1.5 min-h-[44px] rounded-lg bg-[var(--accent-strong)] text-white hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
    >
      <Link size={12} aria-hidden="true" />
      {t("connect")}
    </a>
  );
}

export function SyncOpenBankingButton({ institutionId }: Readonly<{ institutionId: string }>) {
  const [pending, startTransition] = useTransition();
  const t = useTranslations("syncStatus");

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        startTransition(async () => {
          await syncGocardlessAccount(institutionId);
        })
      }
      disabled={pending}
    >
      <RefreshCw size={12} className={pending ? "animate-spin" : ""} aria-hidden="true" />
      {pending ? t("syncing") : t("synchronize")}
    </Button>
  );
}

// Only rendered (see app/settings/page.tsx) when an institution has a
// gocardlessInstitutionId but no account has actually been synced through
// it yet - a stale/incomplete link left over from an abandoned connection
// attempt. Deliberately not gated on gcConfigured, unlike the two buttons
// above: the whole point is to stay reachable even after GOCARDLESS_SECRET_ID
// has been removed from this instance's env, which is exactly when a link
// like this becomes otherwise permanently un-actionable (every other
// GoCardless control disappears, but the "· Open Banking" badge doesn't).
export function DisconnectOpenBankingButton({ institutionId }: Readonly<{ institutionId: string }>) {
  const [pending, startTransition] = useTransition();
  const t = useTranslations("openBanking");

  return (
    <Button
      variant="destructive"
      size="sm"
      onClick={() => startTransition(async () => { await clearGocardlessConnection(institutionId); })}
      disabled={pending}
    >
      <Unlink size={12} aria-hidden="true" />
      {pending ? t("disconnecting") : t("disconnect")}
    </Button>
  );
}
