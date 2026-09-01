"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getViewer, VIEWING_PORTFOLIO_COOKIE } from "@/lib/auth-context";
import { normalizeUsername } from "@/lib/domain/users";

/**
 * The two sharing mechanisms of v2.0 - see CLAUDE.md's "Multi-user
 * architecture". They are deliberately different things, not two settings of
 * one feature:
 *
 * - **Co-ownership** (`AccountCoOwner`) is per ACCOUNT and grants WRITE access.
 *   A joint Livret A appears in both people's portfolios, pointing at the same
 *   rows - no duplication, either can categorize a transaction on it.
 * - **A portfolio grant** (`PortfolioGrant`) is per PERSON and grants READ
 *   access to everything the grantor owns. This is the "my partner can see my
 *   accounts but touch nothing" case.
 *
 * Neither ever widens what a mutation may touch beyond the acting session's
 * own base set: co-ownership does it by putting the account IN that set
 * (baseAccountIds unions it in), a grant does it by never being consulted for
 * writes at all.
 */

/**
 * Resolves a typed-in username to a real user id.
 *
 * Deliberately returns the same error for "no such user" and for an empty
 * input rather than confirming whether a username exists - the same
 * non-disclosure rule assertOwned follows. Sharing is invitation-driven
 * (the admin hands out a link, see lib/actions/users.ts), so anyone
 * legitimately sharing already knows the username they invited.
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
 * Only the account's DIRECT owner manages its co-owners - a co-owner cannot
 * add further co-owners. That keeps the permission graph one level deep: the
 * `Account.userId` row is always the single answer to "who decides who sees
 * this", which is checkable in one query and explainable in one sentence.
 * assertAccountWritable deliberately isn't used here, since it also passes for
 * co-owners.
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
  revalidatePath(`/accounts/${accountId}`);
  return { ok: true };
}

/**
 * H4 - removing a co-owner has to clean up what that person built ON this
 * account, because no FK cascade will ever fire: the account itself survives,
 * so their AlertRules and Goals pointing at it would simply keep existing,
 * now targeting something they can no longer see. An alert rule in that state
 * is worse than useless - checkCustomAlertRules would still evaluate it and
 * push them a notification quoting a balance they have no way to look at.
 *
 * Deliberately scoped to the removed user's OWN rows: the account owner's
 * rules on their own account are untouched, and so is anything the removed
 * co-owner has elsewhere.
 */
export async function removeAccountCoOwner(accountId: string, userId: string): Promise<void> {
  const viewer = await getViewer();
  await assertAccountOwner(accountId, viewer.id);

  await prisma.$transaction([
    prisma.alertRule.deleteMany({ where: { userId, accountId } }),
    prisma.goal.deleteMany({ where: { userId, accountId } }),
    prisma.accountCoOwner.deleteMany({ where: { accountId, userId } }),
  ]);
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/settings");
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
 * Revoking is immediate and needs no cleanup pass: a grant is only ever read
 * at request time by viewAccountIds, which falls back to the grantee's own
 * accounts the moment the row is gone - including for a browser still holding
 * the viewing cookie. Nothing derived from a grant can outlive it, which is
 * exactly why baseAccountIds (the set behind share links and API keys) never
 * includes granted accounts in the first place.
 */
export async function revokePortfolioGrant(granteeUserId: string): Promise<void> {
  const viewer = await getViewer();
  await prisma.portfolioGrant.deleteMany({
    where: { grantorUserId: viewer.id, granteeUserId },
  });
  revalidatePath("/settings");
}

/**
 * The H6 channel: which portfolio the sidebar switcher is currently pointed
 * at. A cookie rather than session state because it's a per-browser-tab-ish UI
 * preference, not a claim - it is re-validated against PortfolioGrant on every
 * single read (see viewAccountIds), and an unknown/revoked value silently
 * resolves back to the viewer's own data instead of erroring.
 *
 * Mutations never consult it, by construction: every Server Action derives its
 * writable set from the session user alone.
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
