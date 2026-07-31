"use client";

import { useTransition } from "react";
import { RefreshCw, Link } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncGocardlessBalances } from "@/lib/actions/gocardless";
import { useTranslations } from "next-intl";

export function ConnectOpenBankingButton({ institutionId }: { institutionId: string }) {
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

export function SyncOpenBankingButton({ institutionId }: { institutionId: string }) {
  const [pending, startTransition] = useTransition();
  const t = useTranslations("syncStatus");

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => startTransition(() => syncGocardlessBalances(institutionId))}
      disabled={pending}
    >
      <RefreshCw size={12} className={pending ? "animate-spin" : ""} aria-hidden="true" />
      {pending ? t("syncing") : t("synchronize")}
    </Button>
  );
}
