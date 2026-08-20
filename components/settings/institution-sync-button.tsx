"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { triggerInstitutionSync } from "@/lib/actions/sync";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

// Real production report: this button had no error handling at all - a
// hung sync (no internet reaching the bank from inside the sync container,
// or a stuck Woob session) left it spinning with zero feedback until
// lib/actions/sync.ts's 2-minute timeout was added. This is what surfaces
// that (or any other) failure once it actually fires, instead of it
// disappearing into an unhandled rejection - same pattern as the syncError
// state added to sync-status.tsx's own "Synchroniser" button for the
// dedicated LCL/TR sources.
export function InstitutionSyncButton({ institutionId }: Readonly<{ institutionId: string }>) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const t = useTranslations("syncStatus");

  const handleSync = () => {
    setError(null);
    startTransition(async () => {
      try {
        await triggerInstitutionSync(institutionId);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : t("unknownError"));
      }
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <Button variant="outline" size="sm" onClick={handleSync} disabled={pending}>
        <RefreshCw size={12} className={pending ? "animate-spin" : ""} aria-hidden="true" />
        <span aria-live="polite">{pending ? t("syncing") : t("synchronize")}</span>
      </Button>
      {error && (
        <p role="alert" className="text-xs text-[var(--negative)] max-w-[200px]">
          {error}
        </p>
      )}
    </div>
  );
}
