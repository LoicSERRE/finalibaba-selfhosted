"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { autoTriggerSync, getSyncStatus } from "@/lib/actions/sync";
import { useTranslations } from "next-intl";
import { isBareRoute } from "@/lib/domain/bare-routes";

/**
 * Déclenche un sync TR+LCL en arrière-plan au chargement de la page (si données
 * > 10 min), puis rafraîchit automatiquement la page quand le sync se termine.
 * Affiche un badge discret pendant la synchronisation.
 */
export function AutoSync() {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("autoSync");
  const mountedAt = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    // Nobody outside the app triggers a real bank sync just by opening a page.
    // That was already true of a share-link visitor (see CLAUDE.md's
    // "Read-only share links" - the one real correctness bug a naive version
    // of that feature would have shipped) and is true for the same reason of
    // someone sitting at the login screen or redeeming an invitation: they are
    // anonymous, and a sync spinner on a page they cannot get past is a
    // scraping run nobody asked for. Shares the sidebar's own predicate.
    if (isBareRoute(pathname ?? "/")) return;

    mountedAt.current = Date.now();
    let attempts = 0;
    // Safety cap (~2min at 5s/attempt) - without it, a sync that never
    // completes (crashed, network failure) would poll forever for as long
    // as the page stays open, same bug class as the missing `triggered`
    // gate below, just for the failure path instead of the no-op path.
    const MAX_ATTEMPTS = 24;

    autoTriggerSync().then(({ triggered }) => {
      // Only poll when a sync was actually triggered - previously this
      // setInterval ran unconditionally on every mount, and only ever
      // stopped once it saw a *new* trade_republic SyncLog row newer than
      // mount time. When nothing was triggered (data wasn't stale), that
      // condition can never become true, so it polled every 5s forever for
      // as long as the page stayed open - confirmed empirically via a
      // devtools network capture showing dozens of accumulated requests to
      // the current route from a single page left open a couple of minutes.
      if (!triggered) return;
      setSyncing(true);

      intervalRef.current = setInterval(async () => {
        attempts += 1;
        // ANY source finishing after mount ends the wait. This used to look
        // at "trade_republic" alone - the .env Trade Republic connection - so
        // for a bank configured in Settings (woob:<id>, tr:<id>) the badge
        // never saw its sync finish and stayed up for the full two minutes.
        const status = await getSyncStatus();
        const latest = Math.max(0, ...Object.values(status).map((log) => new Date(log.createdAt).getTime()));
        if (latest > mountedAt.current || attempts >= MAX_ATTEMPTS) {
          clearInterval(intervalRef.current!);
          setSyncing(false);
          router.refresh();
        }
      }, 5000);
    });

    return () => clearInterval(intervalRef.current!);
  }, [router, pathname]);

  if (!syncing) return null;

  return (
    // pointer-events-none: a status badge must never take a tap meant for
    // what is under it. On a phone it sat bottom-right just above the nav,
    // exactly where each transaction row's action buttons and the
    // pagination's "Next" live (found by scripts/ui-audit's under-fixed
    // check); it now sits at the top centre there, over page headings.
    <div aria-live="polite" aria-label={t("syncing")} className="pointer-events-none fixed top-[calc(env(safe-area-inset-top,0px)+0.75rem)] left-1/2 -translate-x-1/2 md:top-auto md:left-auto md:translate-x-0 md:bottom-6 md:right-6 z-50 flex items-center gap-2 bg-[var(--surface)] border border-[var(--border)] rounded-full px-3 py-1.5 text-xs text-[var(--muted)] shadow-lg">
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--accent)]" />
      </span>
      {t("syncing")}
    </div>
  );
}
