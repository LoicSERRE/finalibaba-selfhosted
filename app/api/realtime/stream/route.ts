import { NextResponse } from "next/server";
import { subscribe } from "@/lib/services/realtime-bus";
import { getViewer } from "@/lib/auth-context";

export const dynamic = "force-dynamic";

// Every 20s - keeps the connection alive through a reverse proxy's own idle
// timeout (this app is routinely deployed behind Nginx Proxy Manager/Caddy/
// Traefik, see CLAUDE.md's "Security headers"). A leading colon is an SSE
// comment line - ignored by EventSource, just keeps bytes flowing.
const HEARTBEAT_MS = 20_000;

/**
 * Server-Sent Events endpoint for components/layout/realtime-refresh.tsx - a bare
 * "something changed" signal, not real data (see CLAUDE.md's "Trade Republic
 * real-time tracking" for why). Goes through the normal NextAuth session gate
 * (not excluded in proxy.ts's matcher, unlike the server-to-server /notify route
 * below) since this one is opened directly by the browser.
 *
 * Resolves the viewer before subscribing (v2.0): the bus is keyed by userId, so
 * this connection only ever receives signals raised for THIS user's own data.
 * Previously it subscribed to a single global channel without reading the
 * session at all.
 */
export async function GET() {
  const viewer = await getViewer();
  const encoder = new TextEncoder();
  let unsubscribe: () => void;
  let heartbeat: ReturnType<typeof setInterval>;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Verified live: the underlying HTTP response doesn't flush headers
      // (so EventSource's own `onopen` doesn't fire) until the first byte
      // is actually enqueued - confirmed with a raw socket probe showing
      // nothing at all arrives until 20s in without this. Sending an
      // immediate comment line makes the connection visibly "open" right
      // away instead of appearing dead for up to a full heartbeat interval.
      controller.enqueue(encoder.encode(": connected\n\n"));
      unsubscribe = subscribe(viewer.id, () => {
        controller.enqueue(encoder.encode("data: refresh\n\n"));
      });
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, HEARTBEAT_MS);
    },
    cancel() {
      clearInterval(heartbeat);
      unsubscribe();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
