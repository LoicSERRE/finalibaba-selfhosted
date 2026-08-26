import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { refreshAccountBalance } from "@/lib/actions/holdings";

/**
 * Called by sync/main.py at the end of every automatic 4h sync run, same
 * call shape as /api/transactions/auto-categorize and /api/alerts/check.
 *
 * Real production feedback: investment/crypto HistoricalBalance rows are
 * event-driven (only written by refreshAccountBalance() when a holding is
 * upserted/deleted/sold/FX-refreshed - see CLAUDE.md's "Historical value
 * chart per investment account"), which a self-hoster who rarely edits a
 * long-held position found left that account's own value chart stuck on
 * "not enough data" indefinitely. This periodically records today's
 * already-known valuation (quantity x lastPriceCents, exactly what
 * refreshAccountBalance already computes) so the chart accumulates real
 * points over time without needing a manual edit to trigger one - the same
 * way a synced fiat account already gets a fresh balance snapshot on every
 * sync cycle. This does NOT fetch new market prices for holdings (still a
 * manual "update the price when you check in" action, unchanged) - only the
 * *recording cadence* of the already-known value changes.
 * RefreshHoldingFxButton (components/account-detail/refresh-holding-fx-button.tsx)
 * stays as the manual "capture a snapshot right now" path alongside this
 * automatic one, not replaced by it.
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

  const accounts = await prisma.account.findMany({
    where: { type: { in: ["INVESTMENT", "CRYPTO"] } },
    select: { id: true },
  });
  await Promise.all(accounts.map((a) => refreshAccountBalance(a.id)));

  return NextResponse.json({ ok: true, count: accounts.length });
}
