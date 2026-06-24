"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { triggerInstitutionSync } from "@/lib/actions/sync";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export function InstitutionSyncButton({ institutionId }: { institutionId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const t = useTranslations("syncStatus");

  const handleSync = () => {
    startTransition(async () => {
      await triggerInstitutionSync(institutionId);
      router.refresh();
    });
  };

  return (
    <button
      onClick={handleSync}
      disabled={pending}
      className="flex items-center gap-1.5 text-xs px-3 py-1.5 min-h-[44px] rounded-lg border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--accent)] transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
    >
      <RefreshCw size={12} className={pending ? "animate-spin" : ""} aria-hidden="true" />
      {pending ? t("syncing") : t("synchronize")}
    </button>
  );
}
