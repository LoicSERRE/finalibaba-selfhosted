import { NextRequest, NextResponse } from "next/server";
import { isInternalRequest } from "@/lib/services/internal-auth";
import { prisma } from "@/lib/db/prisma";
import { baseAccountIds } from "@/lib/auth-context";
import { autoCategorizeForUser } from "@/lib/services/auto-categorize-runner";

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

export async function POST(req: NextRequest) {
  if (!isInternalRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // One pass per user, not one global pass (v2.0). Categorization creates
  // and assigns categories, and both are per-user now - a single global run
  // would file one user's transactions under whichever user's identically-
  // named category happened to be found first. Each pass is scoped to that
  // user's own base account set (own + co-owned), so a co-owned account is
  // legitimately visited by both stakeholders' passes; the engine only ever
  // touches categoryId:null rows, so the second pass simply finds nothing
  // left to do rather than overwriting the first.
  //
  // This has no session to resolve a viewer from (it's the sync container
  // calling in with the shared bearer token), which is why it imports the
  // engine directly instead of going through lib/actions/auto-categorize.ts.
  const users = await prisma.user.findMany({ select: { id: true } });
  let categorized = 0;
  for (const user of users) {
    const accountIds = await baseAccountIds(user.id);
    if (accountIds.length === 0) continue;
    const result = await autoCategorizeForUser(user.id, accountIds);
    categorized += result.categorized;
  }

  return NextResponse.json({ ok: true, categorized });
}
