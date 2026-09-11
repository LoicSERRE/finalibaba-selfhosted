"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { revalidateAccount } from "@/lib/actions/revalidate";
import { prisma } from "@/lib/db/prisma";
import { getViewer, VIEWING_PORTFOLIO_COOKIE } from "@/lib/auth-context";
import { normalizeUsername } from "@/lib/domain/users";

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
 */

/**
 * A typed-in username to a user id. Same error for "no such user" and for empty
 * input, rather than confirming a username exists - the non-disclosure rule
 * assertOwned follows. Sharing is invitation-driven, so anyone legitimate
 * already knows the name.
 */
export type ShareFailure = { ok: false; error: "username_required" | "no_such_user" | "that_is_you" };
export type ShareResult = { ok: true } | ShareFailure;

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
  const count = await prisma.account.count({ where: { id: accountId, userId } });
  if (count === 0) throw new Error("Not found.");
}

export async function listAccountCoOwners(accountId: string) {
  const viewer = await getViewer();
  await assertAccountOwner(accountId, viewer.id);
  const rows = await prisma.accountCoOwner.findMany({
    where: { accountId },
    select: { userId: true, createdAt: true, user: { select: { username: true, displayName: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    userId: r.userId,
    username: r.user.username,
    displayName: r.user.displayName,
    createdAt: r.createdAt,
  }));
}

export async function addAccountCoOwner(
  accountId: string,
  formData: FormData,
): Promise<ShareResult> {
  const viewer = await getViewer();
  await assertAccountOwner(accountId, viewer.id);
  const resolved = await resolveUsername(formData.get("username") as string, viewer.id);
  if (!resolved.ok) return resolved;
  const userId = resolved.userId;

  // Idempotent: re-adding someone already on the account is a no-op rather
  // than a unique-constraint crash the UI would have to translate.
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
  const viewer = await getViewer();
  await assertAccountOwner(accountId, viewer.id);

  await prisma.$transaction([
    prisma.alertRule.deleteMany({ where: { userId, accountId } }),
    prisma.goal.deleteMany({ where: { userId, accountId } }),
    prisma.accountCoOwner.deleteMany({ where: { accountId, userId } }),
  ]);
  revalidateAccount(accountId);
}

// ── Portfolio grants (read-only guests) ────────────────────────────────────

export async function listPortfolioGrants() {
  const viewer = await getViewer();
  const [given, received] = await Promise.all([
    prisma.portfolioGrant.findMany({
      where: { grantorUserId: viewer.id },
      select: { granteeUserId: true, createdAt: true, grantee: { select: { username: true, displayName: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.portfolioGrant.findMany({
      where: { granteeUserId: viewer.id },
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
    where: { grantorUserId: viewer.id, granteeUserId },
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
    // Checked here too, not just on read - no reason to persist a value we
    // already know is invalid, and it lets the switcher fail visibly instead
    // of silently doing nothing.
    const grant = await prisma.portfolioGrant.findUnique({
      where: { grantorUserId_granteeUserId: { grantorUserId, granteeUserId: viewer.id } },
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

// Used by lib/actions/goals.ts-style guards and by the account detail page to
// decide whether to offer co-owner management at all.
export async function isAccountOwner(accountId: string): Promise<boolean> {
  const viewer = await getViewer();
  const count = await prisma.account.count({ where: { id: accountId, userId: viewer.id } });
  return count > 0;
}
