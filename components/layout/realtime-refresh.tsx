"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";

// Routes reachable without a session. The SSE endpoint sits behind the normal
// auth gate, so opening it from one of these gets an HTML /login redirect
// instead of a stream - which the browser reports as a console error ("MIME
// type text/html is not text/event-stream") and then retries forever. Found
// live while testing the v2.0 bootstrap screen.
const UNAUTHENTICATED_PREFIXES = ["/login", "/invite"];

/**
 * Subscribes to app/api/realtime/stream's SSE endpoint and calls
 * router.refresh() on every push - re-runs the currently open route's Server
 * Components against the DB's current state, so a real-time-detected Trade
 * Republic transaction shows up in an already-open tab without a manual
 * reload. See CLAUDE.md's "Trade Republic real-time tracking" for the full
 * design (why SSE over WebSocket, why a bare signal instead of pushing real
 * data). Mounted in the root layout - including on /shared/[token],
 * deliberately (harmless: no sync is triggered, only a re-render of
 * already-computed data) - the stream simply never emits anything when
 * TR_REALTIME_ENABLED is unset server-side.
 *
 * EventSource reconnects on its own after a dropped connection - no manual
 * reconnect logic needed here, only real "message" events trigger a refresh
 * (not the browser's own transient "error" events during a reconnect).
 */
export function RealtimeRefresh() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (UNAUTHENTICATED_PREFIXES.some((prefix) => pathname?.startsWith(prefix))) return;

    const source = new EventSource("/api/realtime/stream");
    source.onmessage = () => router.refresh();
    return () => source.close();
  }, [router, pathname]);

  return null;
}
