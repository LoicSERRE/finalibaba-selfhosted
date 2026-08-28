"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Subscribes to app/api/realtime/stream's SSE endpoint and calls
 * router.refresh() on every push - re-runs the currently open route's Server
 * Components against the DB's current state, so a real-time-detected Trade
 * Republic transaction shows up in an already-open tab without a manual
 * reload. See CLAUDE.md's "Trade Republic real-time tracking" for the full
 * design (why SSE over WebSocket, why a bare signal instead of pushing real
 * data). Mounted unconditionally in the root layout - including on
 * /shared/[token], deliberately (harmless: no sync is triggered, only a
 * re-render of already-computed data) - the stream simply never emits
 * anything when TR_REALTIME_ENABLED is unset server-side.
 *
 * EventSource reconnects on its own after a dropped connection - no manual
 * reconnect logic needed here, only real "message" events trigger a refresh
 * (not the browser's own transient "error" events during a reconnect).
 */
export function RealtimeRefresh() {
  const router = useRouter();

  useEffect(() => {
    const source = new EventSource("/api/realtime/stream");
    source.onmessage = () => router.refresh();
    return () => source.close();
  }, [router]);

  return null;
}
