import { NextRequest, NextResponse } from "next/server";
import { notify } from "@/lib/services/realtime-bus";

/**
 * Called by sync/sync_tr_realtime.py after every real-time-detected write - fans
 * a "something changed" signal out to any open SSE connections (see
 * app/api/realtime/stream/route.ts). No browser session exists on this call
 * path, so - same as api/alerts/check - it's excluded from proxy.ts's NextAuth
 * matcher and gates itself via the shared NEXTAUTH_SECRET bearer token instead.
 */
function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  const expected = process.env.NEXTAUTH_SECRET;
  return !!expected && auth === `Bearer ${expected}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  notify();
  return NextResponse.json({ ok: true });
}
