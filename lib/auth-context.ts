import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { OWNER_USER_ID } from "@/lib/domain/users";

/**
 * Multi-user viewer resolution and access primitives (v2.0) - see CLAUDE.md's
 * "Multi-user architecture".
 *
 * The single most important property of this module: `getViewer()` ALWAYS
 * returns a user. In mono mode (AUTH_ENABLED unset, this project's documented
 * default) it resolves to the fixed owner row the v2 migration created, with
 * no login involved. That's what keeps one uniform code path across the whole
 * app instead of `userId | null` branching everywhere, and it's what makes
 * switching an existing instance to multi-user later a no-op for its data:
 * everything already belongs to the owner, so the bootstrap screen only has to
 * set credentials on that row.
 */

// Re-exported so callers have one obvious import for everything
// viewer-related; the constant itself lives in lib/domain/users.ts to keep
// this module and lib/auth.ts from importing each other in a cycle.
export { OWNER_USER_ID };

export function isAuthEnabled(): boolean {
  return process.env.AUTH_ENABLED === "true";
}

export interface Viewer {
  id: string;
  role: "ADMIN" | "MEMBER";
  /** True when this viewer was resolved from the mono-mode fallback rather
   *  than a real authenticated session - used by the surfaces that must not
   *  offer user management when there is no login at all. */
  isMonoMode: boolean;
}

/**
 * The current user. Throws only if the DB has no owner row at all, which
 * would mean the v2 migration never ran - a broken install, not a state the
 * app should try to paper over.
 */
export async function getViewer(): Promise<Viewer> {
  if (isAuthEnabled()) {
    const session = await getServerSession(authOptions);
    // A session without a userId is a pre-v2 JWT still in a browser from
    // before the upgrade (the old token only carried `sub: "owner"`).
    // Mapping it to the owner keeps those sessions working through the
    // upgrade instead of logging everyone out mid-flight.
    const userId = (session?.user as { id?: string } | undefined)?.id ?? OWNER_USER_ID;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
    if (user) return { id: user.id, role: user.role, isMonoMode: false };
  }

  const owner = await prisma.user.findUnique({
    where: { id: OWNER_USER_ID },
    select: { id: true, role: true },
  });
  if (!owner) {
    throw new Error(
      "No owner user found - the v2.0 multi-user migration has not been applied to this database."
    );
  }
  return { id: owner.id, role: owner.role, isMonoMode: !isAuthEnabled() };
}

export async function requireAdmin(): Promise<Viewer> {
  const viewer = await getViewer();
  if (viewer.role !== "ADMIN") throw new Error("Admin access required.");
  return viewer;
}

/**
 * The accounts a user OWNS - their own plus any they co-own. This is the set
 * every *derived artifact* must use: share links, API keys, alert evaluation,
 * internal-transfer detection, exports, net worth.
 *
 * Deliberately excludes portfolios merely granted to them for reading (see
 * viewAccountIds below). Without that separation a read-only guest could mint
 * a public share link or an API key over someone else's data - one that would
 * keep working after the grant was revoked, since those tokens carry no
 * grant check of their own.
 */
export async function baseAccountIds(userId: string): Promise<string[]> {
  const [owned, coOwned] = await Promise.all([
    prisma.account.findMany({ where: { userId }, select: { id: true } }),
    prisma.accountCoOwner.findMany({ where: { userId }, select: { accountId: true } }),
  ]);
  return [...new Set([...owned.map((a) => a.id), ...coOwned.map((c) => c.accountId)])];
}

/**
 * The accounts a user may currently SEE - their own set, or a grantor's when
 * they're viewing a portfolio shared with them. Request-scoped reads only;
 * mutations must never consult this (they derive their writable set from the
 * session user alone, so a granted view can't be used to write).
 */
export async function viewAccountIds(userId: string, viewedGrantorId?: string | null): Promise<string[]> {
  if (!viewedGrantorId || viewedGrantorId === userId) return baseAccountIds(userId);

  const grant = await prisma.portfolioGrant.findUnique({
    where: { grantorUserId_granteeUserId: { grantorUserId: viewedGrantorId, granteeUserId: userId } },
    select: { role: true },
  });
  if (!grant) return baseAccountIds(userId); // stale/invalid selection - fall back to own
  return baseAccountIds(viewedGrantorId);
}

/**
 * Ownership guard for mutations. Mirrors the existing assert*Eligible family
 * (assertCsvImportEligible, assertGoalAccountEligible, assertIncomeEventEligible,
 * assertHoldingHasTarget) and exists for the same documented reason: a Server
 * Action is directly invocable regardless of what the UI renders, so hiding a
 * button is never an access control.
 */
export async function assertAccountWritable(userId: string, accountId: string): Promise<void> {
  const [owned, coOwned] = await Promise.all([
    prisma.account.count({ where: { id: accountId, userId } }),
    prisma.accountCoOwner.count({ where: { accountId, userId } }),
  ]);
  if (owned === 0 && coOwned === 0) throw new Error("Account not found.");
}

/**
 * The viewer plus their writable account set, resolved together - the shape
 * almost every Server Action needs. Actions that touch accounts should filter
 * their own queries on `accountIds` rather than re-querying ownership per id.
 */
export async function getWritableContext(): Promise<{ userId: string; accountIds: string[] }> {
  const viewer = await getViewer();
  return { userId: viewer.id, accountIds: await baseAccountIds(viewer.id) };
}

/**
 * Prisma `where` fragment restricting a query to accounts the viewer may
 * touch. Returned as a fragment rather than applied by a wrapper so each
 * call site stays a plain, readable Prisma query.
 */
export function accountScope(accountIds: string[]): { accountId: { in: string[] } } {
  return { accountId: { in: accountIds } };
}

/**
 * Ownership guard for entities owned directly by a user rather than through
 * an account (categories, goals, alert rules, share links, API keys...).
 *
 * Throws the same generic "not found" for both "doesn't exist" and "belongs
 * to someone else" - an error that distinguishes them would confirm the
 * existence of another user's data to anyone probing ids.
 */
export async function assertOwned(
  model: "category" | "goal" | "alertRule" | "shareLink" | "apiKey" | "institution",
  id: string,
  userId: string
): Promise<void> {
  // Each branch is its own delegate call: Prisma's per-model types don't
  // unify into a single indexed call without casting away the safety that
  // makes these guards worth having.
  const found = await (async () => {
    switch (model) {
      case "category":
        return prisma.category.count({ where: { id, userId } });
      case "goal":
        return prisma.goal.count({ where: { id, userId } });
      case "alertRule":
        return prisma.alertRule.count({ where: { id, userId } });
      case "shareLink":
        return prisma.shareLink.count({ where: { id, userId } });
      case "apiKey":
        return prisma.apiKey.count({ where: { id, userId } });
      case "institution":
        return prisma.institution.count({ where: { id, userId } });
    }
  })();
  if (found === 0) throw new Error("Not found.");
}

/**
 * Same guard for a batch of ids (bulk categorization, split writes...) -
 * verifies every one of them resolves inside the viewer's own accounts, so a
 * forged id smuggled into an array can't ride along with legitimate ones.
 */
export async function assertTransactionsWritable(userId: string, transactionIds: string[]): Promise<void> {
  if (transactionIds.length === 0) return;
  const accountIds = await baseAccountIds(userId);
  const reachable = await prisma.transaction.count({
    where: { id: { in: transactionIds }, accountId: { in: accountIds } },
  });
  if (reachable !== new Set(transactionIds).size) throw new Error("Not found.");
}
