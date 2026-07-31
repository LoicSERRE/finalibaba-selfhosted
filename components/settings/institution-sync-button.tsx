"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <Button variant="outline" size="sm" onClick={handleSync} disabled={pending}>
      <RefreshCw size={12} className={pending ? "animate-spin" : ""} aria-hidden="true" />
      <span aria-live="polite">{pending ? t("syncing") : t("synchronize")}</span>
    </Button>
  );
}
