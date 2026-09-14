import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getViewer } from "@/lib/auth-context";
import { buildUserExport } from "@/lib/domain/user-export";
import { AUDIT, recordAuditEvent } from "@/lib/services/audit-log";

/**
 * One person's own data, as a file.
 *
 * **Not `requireAdmin`, and that is the point of the route existing.** The only
 * export before this was `/api/backup`, a whole-database `pg_dump` gated on
 * admin - so an invited user could get nothing at all, and the admin could get
 * nothing without also getting everybody else's accounts and transactions in
 * clear. Reported as "je veux pas pouvoir exporter et voir le compte de mes
 * potes, chacun sa sauvegarde". Every user gets this one, including the admin,
 * and it is scoped by `Account.userId` rather than by what they may read - see
 * lib/domain/user-export.ts for why a co-owned account stays with its owner.
 *
 * A Route Handler rather than a Server Action because the result is a
 * download: an action returns a value to React, and handing a browser a file
 * means a real response with its own Content-Disposition.
 *
 * Held in memory rather than streamed, unlike the full dump. A person's own
 * record is bounded by their own history, the payload is assembled from query
 * results that were already in memory, and buying a stream here would cost the
 * one thing that makes this safe to reason about - that the file is complete
 * or it does not exist.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await getViewer();

  const [user, settings, institutions, categories, accounts, recurringTransactions, goals, alertRules] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: viewer.id },
        select: { username: true, displayName: true },
      }),
      prisma.userSettings.findUnique({ where: { userId: viewer.id } }),
      prisma.institution.findMany({ where: { userId: viewer.id }, orderBy: { name: "asc" } }),
      prisma.category.findMany({ where: { userId: viewer.id }, orderBy: { name: "asc" } }),
      prisma.account.findMany({
        // userId, never baseAccountIds: a co-owned account belongs to whoever
        // created it, and exporting it here would hand each co-owner a copy of
        // the other's record.
        where: { userId: viewer.id },
        orderBy: { createdAt: "asc" },
        include: {
          history: { orderBy: { recordedAt: "asc" } },
          transactions: { orderBy: { date: "asc" }, include: { splits: true } },
          holdings: { orderBy: { ticker: "asc" } },
          sales: { orderBy: { date: "asc" } },
          interestRateHistory: { orderBy: { until: "asc" } },
          incomeEvents: { orderBy: { date: "asc" } },
        },
      }),
      prisma.recurringTransaction.findMany({
        where: { account: { userId: viewer.id } },
        orderBy: { label: "asc" },
      }),
      prisma.goal.findMany({ where: { userId: viewer.id }, orderBy: { name: "asc" } }),
      prisma.alertRule.findMany({ where: { userId: viewer.id }, orderBy: { createdAt: "asc" } }),
    ]);

  const payload = buildUserExport({
    user: { username: user?.username ?? null, displayName: user?.displayName ?? null },
    settings: settings as unknown as Record<string, unknown> | null,
    institutions: institutions as unknown as Record<string, unknown>[],
    categories: categories as unknown as Record<string, unknown>[],
    accounts: accounts as unknown as Record<string, unknown>[],
    recurringTransactions: recurringTransactions as unknown as Record<string, unknown>[],
    goals: goals as unknown as Record<string, unknown>[],
    alertRules: alertRules as unknown as Record<string, unknown>[],
  });

  await recordAuditEvent({
    action: AUDIT.dataExported,
    actorId: viewer.id,
    actorLabel: user?.username ?? null,
    detail: `${payload.accounts.length} account(s)`,
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="finalibaba-mes-donnees-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
