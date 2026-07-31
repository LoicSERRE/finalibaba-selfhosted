"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { autoTriggerSync, getSyncStatus } from "@/lib/actions/sync";
import { useTranslations } from "next-intl";

/**
 * Déclenche un sync TR+LCL en arrière-plan au chargement de la page (si données
 * > 10 min), puis rafraîchit automatiquement la page quand le sync se termine.
 * Affiche un badge discret pendant la synchronisation.
 */
export function AutoSync() {
  const router = useRouter();
  const t = useTranslations("autoSync");
  const mountedAt = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    mountedAt.current = Date.now();
    autoTriggerSync().then(({ triggered }) => {
      if (triggered) setSyncing(true);
    });

    intervalRef.current = setInterval(async () => {
      const status = await getSyncStatus();
      const tr = status["trade_republic"];
      const trTime = tr ? new Date(tr.createdAt).getTime() : 0;
      if (trTime > mountedAt.current) {
        clearInterval(intervalRef.current!);
        setSyncing(false);
        router.refresh();
      }
    }, 5000);

    return () => clearInterval(intervalRef.current!);
  }, [router]);

  if (!syncing) return null;

  return (
    <div aria-live="polite" aria-label={t("syncing")} className="fixed bottom-24 right-4 md:bottom-6 md:right-6 z-50 flex items-center gap-2 bg-[var(--surface)] border border-[var(--border)] rounded-full px-3 py-1.5 text-xs text-[var(--muted)] shadow-lg">
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--accent)]" />
      </span>
      {t("syncing")}
    </div>
  );
}
