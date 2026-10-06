"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { autoTriggerSync, getSyncActivity } from "@/lib/actions/sync";
import { useTranslations } from "next-intl";
import { isBareRoute } from "@/lib/domain/bare-routes";

/**
 * Starts a background bank sync when the data is stale, and shows a small
 * badge for exactly as long as a sync is actually running - then refreshes
 * the page once it finishes.
 *
 * Rewritten after "it is there far too often, and it does not go away until
 * I refresh". Three causes, all fixed here:
 *
 * - It never cleared on navigation. This component lives in the root layout,
 *   so it outlives page changes; the old cleanup stopped the polling but left
 *   `syncing` true, and nothing could ever set it back. Every exit path below
 *   now resets it.
 * - It started a sync on every page change (the effect depended on the path).
 *   It now runs once per mount, and at most once per staleness window per tab.
 * - It guessed when a sync ended from SyncLog rows appearing, and a sync that
 *   writes none left it up for two minutes. It now asks the sync service what
 *   is running (getSyncActivity) and shows exactly that.
 */

const POLL_MS = 3_000;
// Hard ceiling for one badge, should the service never report the end.
const MAX_POLLS = 60;
// Mirrors autoTriggerSync's own staleness window, so a tab does not ask the
// server again on every page load only to be told "fresh".
const TRIGGER_THROTTLE_MS = 10 * 60 * 1000;
const LAST_TRIGGER_KEY = "autosync:last-trigger";

function triggeredRecently(): boolean {
  try {
    const at = Number(sessionStorage.getItem(LAST_TRIGGER_KEY));
    return Number.isFinite(at) && Date.now() - at < TRIGGER_THROTTLE_MS;
  } catch {
    return false;
  }
}

function rememberTrigger() {
  try {
    sessionStorage.setItem(LAST_TRIGGER_KEY, String(Date.now()));
  } catch {
    // Private mode or blocked storage: the server-side staleness check still
    // prevents repeated syncs, this only saves the round trip.
  }
}

export function AutoSync() {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("autoSync");
  const [syncing, setSyncing] = useState(false);
  // Read once at mount: navigating must not re-run the trigger.
  const firstPath = useRef(pathname ?? "/");

  useEffect(() => {
    // Nobody outside the app triggers a real bank sync just by opening a page:
    // a share-link visitor, someone at the login screen or redeeming an
    // invitation is anonymous, and a scraping run on their behalf is one
    // nobody asked for. Shares the sidebar's own predicate.
    if (isBareRoute(firstPath.current) || triggeredRecently()) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    let sawRunning = false;

    const poll = async () => {
      if (cancelled) return;
      polls += 1;
      const { running } = await getSyncActivity().catch(() => ({ running: false }));
      if (cancelled) return;
      if (running) {
        sawRunning = true;
        setSyncing(true);
      }
      if (!running || polls >= MAX_POLLS) {
        setSyncing(false);
        // Fresh data only exists if a sync really ran.
        if (sawRunning) router.refresh();
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    };

    autoTriggerSync()
      .then(({ triggered }) => {
        if (cancelled || !triggered) return;
        rememberTrigger();
        void poll();
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      clearTimeout(timer);
      setSyncing(false);
    };
  }, [router]);

  if (!syncing) return null;

  return (
    // Deliberately quiet: a small, translucent pill that never takes a tap
    // meant for what is under it. Top centre on a phone (bottom right is
    // where row actions and the pagination live), bottom right from md.
    <div
      role="status"
      aria-label={t("syncing")}
      className="pointer-events-none fixed top-[calc(env(safe-area-inset-top,0px)+0.5rem)] left-1/2 -translate-x-1/2 md:top-auto md:left-auto md:translate-x-0 md:bottom-4 md:right-4 z-50 flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)]/70 backdrop-blur px-2.5 py-1 text-[11px] text-[var(--muted)]"
    >
      <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--accent)]" />
      </span>
      {t("syncing")}
    </div>
  );
}
