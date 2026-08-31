import { cookies } from "next/headers";
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

/**
 * Which granted portfolio the sidebar switcher is currently pointed at (H6).
 * Set by lib/actions/sharing.ts's setViewingPortfolio; validated against a real
 * PortfolioGrant on every read below, never trusted on its own.
 */
export const VIEWING_PORTFOLIO_COOKIE = "viewing_portfolio";

export interface Viewer {
  id: string;
  role: "ADMIN" | "MEMBER";
  /** True when this viewer was resolved from the mono-mode fallback rather
   *  than a real authenticated session - used by the surfaces that must not
   *  offer user management when there is no login at all. */
  isMonoMode: boolean;
}

/**
 * Thrown when a request carries a validly-signed session for a user who no
 * longer exists - the account was deleted while its owner still had a tab
 * open. The token stays cryptographically valid for its full 30 days, so this
 * is an everyday state, not an attack.
 *
 * It has its own type because the *only* correct response is to stop, and the
 * previous code did the opposite. See getViewer.
 */
export class DeletedSessionUserError extends Error {
  constructor(userId: string) {
    super(`Session references a user that no longer exists: ${userId}`);
    this.name = "DeletedSessionUserError";
  }
}

export function isDeletedSessionUser(e: unknown): boolean {
  return e instanceof DeletedSessionUserError;
}

/**
 * The current user.
 *
 * **The owner fallback below is only ever reachable with no live session.**
 * That distinction is the whole security property of this function, and it was
 * missing: a session naming a user who had been deleted failed the lookup,
 * fell through, and came back as the owner - with `role: "ADMIN"`. A member
 * whose account an admin had just removed became that admin on their next
 * refresh, with full read/write over the entire instance. Reported from a real
 * instance, and reproduced here before fixing (see
 * __tests__/auth-context.test.ts).
 *
 * A deleted user now raises DeletedSessionUserError instead. Deliberately not
 * a redirect: this is called from app/layout.tsx, which renders on /login too,
 * so redirecting there would loop forever. The layout catches it and signs the
 * browser out, which is the one action that actually resolves the state.
 *
 * Throws for a different reason if the DB has no owner row at all - that means
 * the v2 migration never ran, a broken install rather than a state to paper
 * over.
 */
export async function getViewer(): Promise<Viewer> {
  if (isAuthEnabled()) {
    const session = await getServerSession(authOptions);
    const sessionUserId = (session?.user as { id?: string } | undefined)?.id;

    if (sessionUserId) {
      const user = await prisma.user.findUnique({
        where: { id: sessionUserId },
        select: { id: true, role: true },
      });
      // No fallback here, ever. Anything other than the real row for the id
      // this session names is somebody else's identity.
      if (!user) throw new DeletedSessionUserError(sessionUserId);
      return { id: user.id, role: user.role, isMonoMode: false };
    }

    // No session id at all. Two cases, both benign: a pre-v2 JWT still live in
    // a browser from before the upgrade (the old token only carried
    // `sub: "owner"`, and mapping it to the owner is what keeps the upgrade
    // from logging everyone out mid-flight), or no session cookie - which
    // reaches here only on the routes the middleware exempts, /login and
    // /invite among them, where the layout still has to render something.
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
 * Portfolios other users have granted this viewer read access to, resolved to
 * display labels for the sidebar switcher.
 *
 * Lives here rather than in the component that renders it: this repo's layering
 * rule is that components never import prisma directly (business logic and DB
 * access belong in lib/actions or the access layer), and the release-boundary
 * audit greps for exactly that. Read-only and viewer-scoped, so it belongs with
 * the other access primitives rather than in a "use server" action module.
 */
export async function grantedPortfolios(
  userId: string
): Promise<{ userId: string; label: string }[]> {
  const grants = await prisma.portfolioGrant.findMany({
    where: { granteeUserId: userId },
    select: { grantorUserId: true, grantor: { select: { username: true, displayName: true } } },
    orderBy: { createdAt: "asc" },
  });
  return grants.map((g) => ({
    userId: g.grantorUserId,
    label: g.grantor.displayName ?? g.grantor.username ?? g.grantorUserId,
  }));
}

/**
 * Everything a READ surface needs, resolved in one call: who is asking, whose
 * portfolio is on screen, which accounts that means, and whether the viewer may
 * change any of it.
 *
 * `ownerId` is the distinction that makes the portfolio switcher correct rather
 * than half-working. `accountIds` covers everything hanging off an account
 * (transactions, holdings, balances), but a page also reads entities owned by a
 * PERSON - categories, goals, the UserSettings row feeding analytics. Those must
 * follow the portfolio being displayed, not the session: rendering the grantor's
 * transactions against the viewer's own categories would show every row
 * uncategorized, which looks like broken data rather than a permission boundary.
 *
 * `readOnly` is true exactly when a granted portfolio is being displayed. Pages
 * pass it down to suppress mutation affordances - not as the access control
 * itself (that lives in the Server Actions, which never consult this) but so a
 * guest is never shown a button that would only fail.
 *
 * MUTATIONS MUST NOT USE THIS. They resolve their writable set from
 * getWritableContext/baseAccountIds, which know nothing about the cookie.
 */
export interface ViewContext {
  viewer: Viewer;
  /** Whose portfolio is displayed - the viewer, or a grantor they may read. */
  ownerId: string;
  accountIds: string[];
  readOnly: boolean;
}

export async function getViewContext(): Promise<ViewContext> {
  const viewer = await getViewer();
  const requested = (await cookies()).get(VIEWING_PORTFOLIO_COOKIE)?.value;

  if (!requested || requested === viewer.id) {
    return { viewer, ownerId: viewer.id, accountIds: await baseAccountIds(viewer.id), readOnly: false };
  }

  const grant = await prisma.portfolioGrant.findUnique({
    where: { grantorUserId_granteeUserId: { grantorUserId: requested, granteeUserId: viewer.id } },
    select: { grantorUserId: true },
  });
  // Revoked or never existed: fall back to the viewer's own portfolio in full
  // read-write mode rather than erroring. A stale cookie is an everyday state
  // (the grantor revoked while a tab sat open), not an attack to shout about.
  if (!grant) {
    return { viewer, ownerId: viewer.id, accountIds: await baseAccountIds(viewer.id), readOnly: false };
  }

  return {
    viewer,
    ownerId: requested,
    accountIds: await baseAccountIds(requested),
    readOnly: true,
  };
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
