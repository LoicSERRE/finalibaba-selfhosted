import { NextRequest, NextResponse } from "next/server";
import { notify } from "@/lib/services/realtime-bus";
import { OWNER_USER_ID } from "@/lib/domain/users";

/**
 * Called by sync/sync_tr_realtime.py after every real-time-detected write - fans
 * a "something changed" signal out to any open SSE connections (see
 * app/api/realtime/stream/route.ts). No browser session exists on this call
 * path, so - same as api/alerts/check - it's excluded from proxy.ts's NextAuth
 * matcher and gates itself via the shared NEXTAUTH_SECRET bearer token instead.
 *
 * The bus is keyed by userId as of v2.0, but the caller has no notion of users:
 * sync_tr_realtime.py drives the .env-configured Trade Republic integration,
 * which belongs to the owner by definition (decision D3), so an omitted userId
 * defaults to the owner. That keeps the Python side byte-identical - the same
 * reasoning behind the permanent DB-level userId default on Account/SyncLog.
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
  const body = (await req.json().catch(() => ({}))) as { userId?: string };
  notify(body.userId ?? OWNER_USER_ID);
  return NextResponse.json({ ok: true });
}
