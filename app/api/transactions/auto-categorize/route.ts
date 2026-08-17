import { NextRequest, NextResponse } from "next/server";
import { autoCategorizeTransactions } from "@/lib/actions/auto-categorize";

/**
 * Called by sync/main.py at the end of every automatic 4h sync run, right
 * after checkAlerts - same call shape and same reasoning for existing here
 * rather than on-demand: this runs whether the app is open or not, so a
 * newly-synced merchant gets categorized without the user having to open
 * the app first. Same auth as /api/alerts/check - NEXTAUTH_SECRET doubles
 * as the shared bearer token between the sync and app containers, see
 * CLAUDE.md's "Alerts & webhooks" for why that's reused rather than a new
 * secret.
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

  const result = await autoCategorizeTransactions();

  return NextResponse.json({ ok: true, ...result });
}
