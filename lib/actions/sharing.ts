"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { revalidateAccount } from "@/lib/actions/revalidate";
import { prisma } from "@/lib/db/prisma";
import { getViewer, VIEWING_PORTFOLIO_COOKIE } from "@/lib/auth-context";
import { normalizeUsername } from "@/lib/domain/users";
import { assertId } from "@/lib/domain/action-input";

/**
 * Two sharing mechanisms, deliberately not two settings of one:
 *
 * - **Co-ownership** is per ACCOUNT and grants WRITE - a joint Livret A in both
 *   portfolios, pointing at the same rows.
 * - **A portfolio grant** is per PERSON and grants READ over everything the
 *   grantor owns.
 *
 * Neither widens what a MUTATION may touch: co-ownership puts the account in
 * baseAccountIds, a grant is never consulted for writes at all.
 *
 * Both are INVITATIONS since v2.23: created pending (acceptedAt null), with no
 * effect anywhere until the invited user accepts. They used to apply at once,
 * so any member could push an account into somebody else's net worth, alerts
 * and ledger by typing their username. lib/auth-context.ts ignores pending
 * rows; the respond* actions below are the only way to change that.
 */

/**
 * A typed-in username to a user id. Same error for "no such user" and for empty
 * input, rather than confirming a username exists - the non-disclosure rule
 * assertOwned follows. Sharing is invitation-driven, so anyone legitimate
 * already knows the name.
 */
export type ShareFailure = { ok: false; error: "username_required" | "no_such_user" | "that_is_you" };
export type ShareResult = { ok: true } | ShareFailure;
/** Co-ownership can also be refused for the account itself. */
export type CoOwnerResult = ShareResult | { ok: false; error: "company_account" };

/**
 * Returned rather than thrown, like every other expected failure in this
 * codebase: Next replaces a thrown Server Action error with an opaque digest
 * in production, so "no such user" showed up as an unreadable internal error -
 * reported as exactly that. Stable keys, translated by the caller.
 */
async function resolveUsername(
  raw: string,
  selfId: string,
): Promise<{ ok: true; userId: string } | ShareFailure> {
  const username = normalizeUsername(raw ?? "");
  if (!username) return { ok: false, error: "username_required" };

  const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!user) return { ok: false, error: "no_such_user" };
  if (user.id === selfId) return { ok: false, error: "that_is_you" };
  return { ok: true, userId: user.id };
}

// ── Co-ownership ───────────────────────────────────────────────────────────

/**
 * Only the DIRECT owner manages co-owners, so the permission graph stays one
 * level deep and `Account.userId` is the single answer to "who decides who sees
 * this". Not assertAccountWritable, which also passes for co-owners.
 */
async function assertAccountOwner(accountId: string, userId: string): Promise<void> {
  const count = await prisma.account.count({ where: { id: assertId(accountId), userId } });
  if (count === 0) throw new Error("Not found.");
}

export async function listAccountCoOwners(accountId: string) {
  const viewer = await getViewer();
  await assertAccountOwner(accountId, viewer.id);
  const rows = await prisma.accountCoOwner.findMany({
    where: { accountId },
    select: { userId: true, createdAt: true, acceptedAt: true, user: { select: { username: true, displayName: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    userId: r.userId,
    username: r.user.username,
    displayName: r.user.displayName,
    createdAt: r.createdAt,
    pending: r.acceptedAt === null,
  }));
}

export async function addAccountCoOwner(
  accountId: string,
  formData: FormData,
): Promise<CoOwnerResult> {
  const viewer = await getViewer();
  await assertAccountOwner(accountId, viewer.id);
  // A company's account is shared through the cap table, never co-owned: a
  // co-owner would count it at 100 % in their own net worth, beside the
  // share the company already gives the associates.
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { companyId: true } });
  if (account?.companyId) return { ok: false, error: "company_account" };
  const resolved = await resolveUsername(formData.get("username") as string, viewer.id);
  if (!resolved.ok) return resolved;
  const userId = resolved.userId;

  // Idempotent: re-adding someone already on the account is a no-op rather
  // than a unique-constraint crash the UI would have to translate. Created
  // pending - acceptedAt is only ever set by the invited user.
  await prisma.accountCoOwner.upsert({
    where: { accountId_userId: { accountId, userId } },
    create: { accountId, userId },
    update: {},
  });
  revalidateAccount(accountId);
  return { ok: true };
}

/**
 * Needs an explicit cleanup because no FK cascade fires: the account survives,
 * so the removed person's AlertRules and Goals would keep pointing at something
 * they can no longer see - and such a rule still evaluates, pushing them a
 * notification quoting a balance they cannot look at.
 *
 * Scoped to the removed user's OWN rows on THIS account, nothing else.
 */
export async function removeAccountCoOwner(accountId: string, userId: string): Promise<void> {
  accountId = assertId(accountId);
  const coOwnerId = assertId(userId);
  const viewer = await getViewer();
  await assertAccountOwner(accountId, viewer.id);

  await prisma.$transaction([
    prisma.alertRule.deleteMany({ where: { userId: coOwnerId, accountId } }),
    prisma.goal.deleteMany({ where: { userId: coOwnerId, accountId } }),
    prisma.accountCoOwner.deleteMany({ where: { accountId, userId: coOwnerId } }),
  ]);
  revalidateAccount(accountId);
}

// ── Portfolio grants (read-only guests) ────────────────────────────────────

export async function listPortfolioGrants() {
  const viewer = await getViewer();
  const [given, received] = await Promise.all([
    prisma.portfolioGrant.findMany({
      where: { grantorUserId: viewer.id },
      select: {
        granteeUserId: true,
        createdAt: true,
        acceptedAt: true,
        grantee: { select: { username: true, displayName: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    // Accepted only: a pending one is listed by listPendingShares instead.
    prisma.portfolioGrant.findMany({
      where: { granteeUserId: viewer.id, acceptedAt: { not: null } },
      select: { grantorUserId: true, createdAt: true, grantor: { select: { username: true, displayName: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return {
    given: given.map((g) => ({
      userId: g.granteeUserId,
      username: g.grantee.username,
      displayName: g.grantee.displayName,
      createdAt: g.createdAt,
      pending: g.acceptedAt === null,
    })),
    received: received.map((g) => ({
      userId: g.grantorUserId,
      username: g.grantor.username,
      displayName: g.grantor.displayName,
      createdAt: g.createdAt,
    })),
  };
}

export async function grantPortfolioAccess(formData: FormData): Promise<ShareResult> {
  const viewer = await getViewer();
  const resolved = await resolveUsername(formData.get("username") as string, viewer.id);
  if (!resolved.ok) return resolved;
  const granteeUserId = resolved.userId;

  await prisma.portfolioGrant.upsert({
    where: { grantorUserId_granteeUserId: { grantorUserId: viewer.id, granteeUserId } },
    create: { grantorUserId: viewer.id, granteeUserId },
    update: {},
  });
  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Immediate, with no cleanup pass: a grant is only read at request time, so a
 * browser still holding the cookie falls back to its own accounts. Nothing
 * derived can outlive it - which is why baseAccountIds, the set behind share
 * links and API keys, never includes granted accounts.
 */
export async function revokePortfolioGrant(granteeUserId: string): Promise<void> {
  const viewer = await getViewer();
  await prisma.portfolioGrant.deleteMany({
    where: { grantorUserId: viewer.id, granteeUserId: assertId(granteeUserId) },
  });
  revalidatePath("/settings");
}

/**
 * Which portfolio the switcher points at. A cookie because it is a UI
 * preference, not a claim: re-validated against PortfolioGrant on EVERY read,
 * and an unknown or revoked value resolves back to the viewer's own data rather
 * than erroring. Mutations never consult it.
 */
export async function setViewingPortfolio(grantorUserId: string | null): Promise<void> {
  const viewer = await getViewer();
  const jar = await cookies();

  if (!grantorUserId || grantorUserId === viewer.id) {
    jar.delete(VIEWING_PORTFOLIO_COOKIE);
  } else {
    grantorUserId = assertId(grantorUserId);
    // Checked here too, not just on read - no reason to persist a value we
    // already know is invalid, and it lets the switcher fail visibly instead
    // of silently doing nothing.
    const grant = await prisma.portfolioGrant.findUnique({
      where: { grantorUserId_granteeUserId: { grantorUserId, granteeUserId: viewer.id }, acceptedAt: { not: null } },
      select: { grantorUserId: true },
    });
    if (!grant) throw new Error("Not found.");
    jar.set(VIEWING_PORTFOLIO_COOKIE, grantorUserId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
  }

  revalidatePath("/", "layout");
}

// ── Invitations addressed to the viewer ────────────────────────────────────

/** What other users have offered the viewer and is waiting for an answer. */
export async function listPendingShares() {
  const viewer = await getViewer();
  const [coOwnerships, grants] = await Promise.all([
    prisma.accountCoOwner.findMany({
      where: { userId: viewer.id, acceptedAt: null },
      select: {
        accountId: true,
        account: { select: { name: true, user: { select: { username: true, displayName: true } } } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.portfolioGrant.findMany({
      where: { granteeUserId: viewer.id, acceptedAt: null },
      select: { grantorUserId: true, grantor: { select: { username: true, displayName: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return {
    coOwnerships: coOwnerships.map((c) => ({
      accountId: c.accountId,
      accountName: c.account.name,
      from: c.account.user.displayName ?? c.account.user.username,
    })),
    grants: grants.map((g) => ({
      grantorUserId: g.grantorUserId,
      from: g.grantor.displayName ?? g.grantor.username,
    })),
  };
}

/**
 * Accept or decline a co-ownership offered to the viewer. Only ever touches
 * the viewer's own PENDING row: accepting cannot be replayed onto anything
 * else, and declining is not a way to leave an account already accepted
 * (that stays with the owner, through removeAccountCoOwner and its cleanup).
 */
export async function respondToCoOwnership(accountId: string, accept: boolean): Promise<void> {
  accountId = assertId(accountId);
  const viewer = await getViewer();
  const where = { accountId, userId: viewer.id, acceptedAt: null };
  // `=== true`: the argument is client-supplied, and "yes" or {} must not
  // count as consent.
  const { count } = accept === true
    ? await prisma.accountCoOwner.updateMany({ where, data: { acceptedAt: new Date() } })
    : await prisma.accountCoOwner.deleteMany({ where });
  if (count === 0) throw new Error("Not found.");
  // Accepting puts the account in every page of the viewer's portfolio.
  revalidatePath("/", "layout");
}

/** Same rules as respondToCoOwnership, for a read-only portfolio grant. */
export async function respondToPortfolioGrant(grantorUserId: string, accept: boolean): Promise<void> {
  grantorUserId = assertId(grantorUserId);
  const viewer = await getViewer();
  const where = { grantorUserId, granteeUserId: viewer.id, acceptedAt: null };
  const { count } = accept === true
    ? await prisma.portfolioGrant.updateMany({ where, data: { acceptedAt: new Date() } })
    : await prisma.portfolioGrant.deleteMany({ where });
  if (count === 0) throw new Error("Not found.");
  // The sidebar switcher lists accepted grants.
  revalidatePath("/", "layout");
}

// Used by lib/actions/goals.ts-style guards and by the account detail page to
// decide whether to offer co-owner management at all.
export async function isAccountOwner(accountId: string): Promise<boolean> {
  const viewer = await getViewer();
  const count = await prisma.account.count({ where: { id: accountId, userId: viewer.id } });
  return count > 0;
}
