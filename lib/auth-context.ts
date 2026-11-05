import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { OWNER_USER_ID } from "@/lib/domain/users";
import { assertId, assertIds } from "@/lib/domain/action-input";
import { requiresTwoFactor } from "@/lib/services/two-factor-policy";

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
 * A public, read-only demo instance (`DEMO_MODE=true`).
 *
 * A function beside isAuthEnabled rather than a raw env read at each call
 * site, because this string used to be compared by hand sixteen times across
 * the app - thirteen of them in app/settings/page.tsx alone, and in both
 * directions (`=== "true"` and `!== "true"`). Every one of those decides
 * whether to render a section that mutates, reveals a stored credential
 * (SMTP password, ntfy token) or mints a token, so a single drift - a
 * capitalised value, an inverted comparison - offers a public instance
 * something it must never show.
 *
 * It is not the enforcement: proxy.ts returns 403 for every non-GET request
 * in demo mode, and that stays the boundary. This only decides what is worth
 * rendering, so a demo visitor is never shown a control whose only possible
 * outcome is an error. proxy.ts deliberately does NOT call this - middleware
 * runs on the edge runtime and this module pulls in Prisma.
 */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
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

/**
 * Thrown when a validly-signed session was issued before its user revoked
 * every session - a stolen laptop, a shared device, a password change.
 *
 * Its own type alongside DeletedSessionUserError because the correct response
 * is identical (stop, sign the browser out) while the cause is not, and a
 * log line saying which one happened is the difference between "somebody
 * revoked this" and "this account is gone".
 */
export class RevokedSessionError extends Error {
  constructor(userId: string) {
    super(`Session for ${userId} was issued before that user revoked their sessions`);
    this.name = "RevokedSessionError";
  }
}

export function isDeletedSessionUser(e: unknown): boolean {
  return e instanceof DeletedSessionUserError;
}

/** True only for a session its own user ended, never for a deleted account. */
export function isRevokedSession(e: unknown): boolean {
  return e instanceof RevokedSessionError;
}

/** Either reason a live session must stop being honoured. */
export function isEndedSession(e: unknown): boolean {
  return e instanceof DeletedSessionUserError || e instanceof RevokedSessionError;
}

/**
 * Whether a session must be refused because its user ended it.
 *
 * Compares against when the token was ISSUED, not when it expires: a 30-day
 * JWT cannot be recalled, so the only way to end one is to refuse it. Until
 * this existed the sole way to stop somebody's session was to delete their
 * account, which cascades their whole portfolio - a stolen phone meant
 * choosing between a live session and destroying real data.
 *
 * **A token with no issue stamp counts as revoked, not as trusted.** Those
 * predate the feature, and honouring one would make revocation a no-op for
 * precisely the sessions it is aimed at. `issuedAt` is JWT seconds, hence the
 * conversion - reading it as milliseconds would put every real token in 1970
 * and revoke everybody.
 *
 * Extracted from getViewer so this comparison can be tested on its own: it is
 * the whole security property, and it was previously reachable only by
 * standing up a session.
 */
export function isSessionRevoked(
  revokedAt: Date | null | undefined,
  issuedAtSeconds: number | null | undefined
): boolean {
  if (!revokedAt) return false;
  const issuedMs = issuedAtSeconds ? issuedAtSeconds * 1000 : 0;
  return issuedMs < revokedAt.getTime();
}

/**
 * Raised when auth is on and the request carries no session at all.
 *
 * Before this existed, "no session" resolved to the instance owner with role
 * ADMIN. That was meant for the public routes (/login, /invite/*, /shared/*),
 * where the layout still has to render something - but a Server Action is
 * invocable from any page, those three included, so an anonymous request to a
 * public route ran every action on that page as the owner. "Nobody is signed
 * in" now means exactly that, and only getPublicViewer() may turn it into a
 * value.
 */
export class UnauthenticatedError extends Error {
  constructor() {
    super("Authentication required.");
    this.name = "UnauthenticatedError";
  }
}

export function isUnauthenticated(e: unknown): boolean {
  return e instanceof UnauthenticatedError;
}

/**
 * Raised when the instance requires 2FA and this user has not set it up yet.
 *
 * The policy used to live in app/layout.tsx alone, which swapped the page for
 * the setup screen - but a Server Action or an API route never goes through a
 * layout, so a password alone still reached every action, the CSV exports and
 * the REST API. getViewer now refuses such a user everywhere, and only the
 * enrolment itself (getViewerForTwoFactorSetup) gets past it.
 */
export class TwoFactorEnrollmentRequiredError extends Error {
  constructor(userId: string) {
    super(`The instance requires two-factor authentication and ${userId} has not set it up`);
    this.name = "TwoFactorEnrollmentRequiredError";
  }
}

export function isTwoFactorEnrollmentRequired(e: unknown): boolean {
  return e instanceof TwoFactorEnrollmentRequiredError;
}

async function ownerViewer(isMonoMode: boolean): Promise<Viewer> {
  const owner = await prisma.user.findUnique({
    where: { id: OWNER_USER_ID },
    select: { id: true, role: true },
  });
  if (!owner) {
    throw new Error(
      "No owner user found - the v2.0 multi-user migration has not been applied to this database."
    );
  }
  return { id: owner.id, role: owner.role, isMonoMode };
}

/**
 * The signed-in user, or null when auth is on and nobody is signed in.
 *
 * Every caller except getPublicViewer goes through getViewer, which turns the
 * null into an UnauthenticatedError. A deleted or revoked session still
 * throws here: those are not "anonymous", they are a browser that must be
 * signed out.
 */
type ResolvedViewer = { viewer: Viewer; totpEnabled: boolean };

async function resolveViewer(): Promise<ResolvedViewer | null> {
  // Mono mode has no login for a second factor to sit behind.
  if (!isAuthEnabled()) return { viewer: await ownerViewer(true), totpEnabled: false };

  const session = await getServerSession(authOptions);
  if (!session) return null;

  const sessionUserId = (session.user as { id?: string } | undefined)?.id;
  if (!sessionUserId) {
    // A SIGNED session that carries no user id would only be a pre-v2 JWT
    // (it carried `sub: "owner"` and no id). Those expired long ago (30-day
    // maxAge), so rather than widen such a token to the OWNER - handing full
    // admin to any token that happens to lack an id - deny it: a fresh login
    // mints a proper one. Deny or narrow, never widen.
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUserId },
    // sessionsRevokedAt and totpEnabled ride along on the query this already
    // makes, so checking revocation and the 2FA policy costs nothing extra.
    select: { id: true, role: true, sessionsRevokedAt: true, totpEnabled: true },
  });
  // No fallback here, ever. Anything other than the real row for the id
  // this session names is somebody else's identity.
  if (!user) throw new DeletedSessionUserError(sessionUserId);

  // Revocation compares against when the token was ISSUED, not when it
  // expires: a 30-day JWT cannot be recalled, so the only way to end one
  // is to refuse it.
  const issuedAt = (session.user as { issuedAt?: number } | undefined)?.issuedAt;
  if (isSessionRevoked(user.sessionsRevokedAt, issuedAt)) {
    throw new RevokedSessionError(user.id);
  }
  return { viewer: { id: user.id, role: user.role, isMonoMode: false }, totpEnabled: user.totpEnabled };
}

/** The instance policy applied to one resolved user. The policy row is only
 *  read for a user without 2FA, so an enrolled user pays nothing for it. */
async function mustEnrollTwoFactor({ viewer, totpEnabled }: ResolvedViewer): Promise<boolean> {
  return !viewer.isMonoMode && !totpEnabled && (await requiresTwoFactor());
}

/**
 * The current user. Throws UnauthenticatedError when auth is on and the
 * request has no session - never falls back to the owner for an anonymous
 * caller. In mono mode (AUTH_ENABLED off) the owner IS the user.
 *
 * A session naming a deleted user raises DeletedSessionUserError, a revoked
 * one RevokedSessionError; app/layout.tsx catches both and signs the browser
 * out (not a redirect - the layout renders on /login too, so it would loop).
 * A user the 2FA policy says must enrol first raises
 * TwoFactorEnrollmentRequiredError.
 */
export async function getViewer(): Promise<Viewer> {
  const resolved = await resolveViewer();
  if (!resolved) throw new UnauthenticatedError();
  if (await mustEnrollTwoFactor(resolved)) throw new TwoFactorEnrollmentRequiredError(resolved.viewer.id);
  return resolved.viewer;
}

/**
 * getViewer without the 2FA policy, for the enrolment actions only
 * (lib/actions/totp.ts): they are how a user satisfies the policy, so they
 * cannot be behind it. Everything they do is to the caller's own 2FA state.
 */
export async function getViewerForTwoFactorSetup(): Promise<Viewer> {
  const resolved = await resolveViewer();
  if (!resolved) throw new UnauthenticatedError();
  return resolved.viewer;
}

/**
 * The current user, or null for an anonymous visitor. Only for the root
 * layout, which renders on the public routes (/login, /invite/*, /shared/*)
 * too and has to decide what shell to draw there. Nothing that reads or
 * writes user data may use it: a null here must render less, never resolve to
 * somebody.
 */
export async function getPublicViewer(): Promise<Viewer | null> {
  return (await resolveViewer())?.viewer ?? null;
}

export async function requireAdmin(): Promise<Viewer> {
  const viewer = await getViewer();
  if (viewer.role !== "ADMIN") throw new Error("Admin access required.");
  return viewer;
}

/**
 * Only an ACCEPTED co-ownership or grant has any effect. Until v2.23 sharing
 * was imposed: any member could put one of their accounts into somebody
 * else's net worth, alerts and ledger, or a grant into their switcher, just by
 * typing a username. A pending row (acceptedAt null) now counts for nothing
 * here, so every read built on these primitives ignores it - and nothing
 * outside this module queries those tables for access.
 */
const ACCEPTED = { acceptedAt: { not: null } } as const;

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
  // companyId: null on both sides. A company's accounts belong to its manager
  // (Account.userId) but are the company's patrimony: the manager's personal
  // figures count their SHARE of the company (lib/services/company-shares.ts),
  // never its accounts at 100 %. Excluding them here, once, is what keeps the
  // dashboard, exports, API, alerts and share links from each having to.
  const [owned, coOwned] = await Promise.all([
    prisma.account.findMany({ where: { userId, companyId: null }, select: { id: true } }),
    prisma.accountCoOwner.findMany({
      where: { userId, ...ACCEPTED, account: { companyId: null } },
      select: { accountId: true },
    }),
  ]);
  return [...new Set([...owned.map((a) => a.id), ...coOwned.map((c) => c.accountId)])];
}

/**
 * Every account a user may WRITE: baseAccountIds plus the accounts of the
 * companies they manage. For mutations that filter a batch by account
 * (categorizing, undoing, re-running auto-categorization) - never for a net
 * worth or a derived artifact, which would then count a company at 100 %.
 */
export async function writableAccountIds(userId: string): Promise<string[]> {
  const [personal, managed] = await Promise.all([
    baseAccountIds(userId),
    prisma.account.findMany({ where: { userId, companyId: { not: null } }, select: { id: true } }),
  ]);
  return [...new Set([...personal, ...managed.map((a) => a.id)])];
}

/**
 * writableAccountIds split by patrimony: the personal set, then one set per
 * managed company. For the passes that PAIR accounts with each other -
 * internal-transfer detection, history-based categorization - since a
 * transfer from a personal account to the company's is a real movement
 * between two patrimonies, never an internal one.
 */
export async function accountPools(userId: string): Promise<string[][]> {
  const [personal, managed] = await Promise.all([
    baseAccountIds(userId),
    prisma.account.findMany({ where: { userId, companyId: { not: null } }, select: { id: true, companyId: true } }),
  ]);
  const byCompany = new Map<string, string[]>();
  for (const a of managed) {
    const pool = byCompany.get(a.companyId!) ?? [];
    pool.push(a.id);
    byCompany.set(a.companyId!, pool);
  }
  return [personal, ...byCompany.values()].filter((pool) => pool.length > 0);
}

// ── Companies (dev-docs/companies.md) ──────────────────────────────────────

export type CompanyRole = "manager" | "associate";

/**
 * What this user is to this company: its manager, an associate who accepted
 * being linked to it, or nothing (null) - a missing company and somebody
 * else's give the same null, so a caller cannot tell them apart.
 */
export async function companyRole(userId: string, companyId: string): Promise<CompanyRole | null> {
  companyId = assertId(companyId);
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { managerUserId: true } });
  if (!company) return null;
  if (company.managerUserId === userId) return "manager";
  // An associate is someone the cap table in force TODAY names (step 5): an
  // associate who ceded everything they held loses access on the day it took
  // effect, even though older versions still record their parts.
  const versionId = await currentCapTableVersionId(companyId);
  if (!versionId) return null;
  const inVersion = { some: { versionId } };
  const linked = await prisma.companyAssociate.count({
    where: {
      companyId,
      userId,
      linkAcceptedAt: { not: null },
      OR: [{ holdings: inVersion }, { usufructs: inVersion }, { bareOwnerships: inVersion }],
    },
  });
  return linked > 0 ? "associate" : null;
}

/** The cap table version in force today: the latest started, else the earliest. */
export async function currentCapTableVersionId(companyId: string): Promise<string | null> {
  const started = await prisma.companyCapTableVersion.findFirst({
    where: { companyId, effectiveFrom: { lte: new Date() } },
    orderBy: { effectiveFrom: "desc" },
    select: { id: true },
  });
  if (started) return started.id;
  const first = await prisma.companyCapTableVersion.findFirst({
    where: { companyId },
    orderBy: { effectiveFrom: "asc" },
    select: { id: true },
  });
  return first?.id ?? null;
}

/** Every company mutation's guard: only the manager, same "Not found." otherwise. */
export async function assertCompanyManager(userId: string, companyId: string): Promise<void> {
  if ((await companyRole(userId, companyId)) !== "manager") throw new Error("Not found.");
}

/** The company's own accounts - its scope, for reads guarded by companyRole. */
export async function companyAccountIds(companyId: string): Promise<string[]> {
  const rows = await prisma.account.findMany({ where: { companyId: assertId(companyId) }, select: { id: true } });
  return rows.map((r) => r.id);
}

/**
 * Read access to one company account, from outside the company scope: the
 * manager may write it, an accepted associate read it, anyone else nothing
 * (null - same as an account that does not exist). The account page uses it
 * so a company's accounts open from the company's own page.
 */
export async function companyAccountAccess(
  userId: string,
  accountId: string,
): Promise<{ companyId: string; role: CompanyRole; managerUserId: string } | null> {
  const account = await prisma.account.findUnique({
    where: { id: assertId(accountId) },
    select: { companyId: true, userId: true },
  });
  if (!account?.companyId) return null;
  const role = await companyRole(userId, account.companyId);
  return role ? { companyId: account.companyId, role, managerUserId: account.userId } : null;
}

/** Every company this user manages or holds an accepted link to. */
export async function viewerCompanies(userId: string): Promise<{ id: string; name: string; role: CompanyRole }[]> {
  const rows = await prisma.company.findMany({
    where: {
      OR: [{ managerUserId: userId }, { associates: { some: { userId, linkAcceptedAt: { not: null } } } }],
    },
    select: { id: true, name: true, managerUserId: true },
    orderBy: { name: "asc" },
  });
  // The same rule as companyRole, so a former associate is not listed a
  // company they can no longer open.
  const roles = await Promise.all(rows.map((c) => (c.managerUserId === userId ? "manager" : companyRole(userId, c.id))));
  return rows.flatMap((c, i) => {
    const role = roles[i];
    return role ? [{ id: c.id, name: c.name, role }] : [];
  });
}

/** The viewing cookie's value for a company, beside a grantor's user id. A
 *  cuid never contains ":", so the two cannot be confused. */
export const COMPANY_SCOPE_PREFIX = "company:";

/**
 * The accounts a user may currently SEE - their own set, or a grantor's when
 * they're viewing a portfolio shared with them. Request-scoped reads only;
 * mutations must never consult this (they derive their writable set from the
 * session user alone, so a granted view can't be used to write).
 */
export async function viewAccountIds(userId: string, viewedGrantorId?: string | null): Promise<string[]> {
  if (!viewedGrantorId || viewedGrantorId === userId) return baseAccountIds(userId);

  const grant = await prisma.portfolioGrant.findUnique({
    where: { grantorUserId_granteeUserId: { grantorUserId: viewedGrantorId, granteeUserId: userId }, ...ACCEPTED },
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
    where: { granteeUserId: userId, ...ACCEPTED },
    select: { grantorUserId: true, grantor: { select: { username: true, displayName: true } } },
    orderBy: { createdAt: "asc" },
  });
  return grants.map((g) => ({
    userId: g.grantorUserId,
    label: g.grantor.displayName ?? g.grantor.username ?? g.grantorUserId,
  }));
}

/**
 * Everything a READ surface needs in one call.
 *
 * `ownerId` is what makes the portfolio switcher correct: `accountIds` covers
 * what hangs off an account, but categories, goals and UserSettings are owned
 * by a PERSON and must follow the portfolio on screen - the grantor's
 * transactions against the viewer's categories render as entirely
 * uncategorised, which reads as broken data rather than a boundary.
 *
 * `readOnly` only suppresses mutation affordances; the access control is in the
 * Server Actions.
 *
 * MUTATIONS MUST NOT USE THIS - they resolve their writable set from
 * getWritableContext/baseAccountIds, which know nothing about the cookie.
 */
export interface ViewContext {
  viewer: Viewer;
  /** Whose portfolio is displayed - the viewer, or a grantor they may read.
   *  For a company, its manager (categories and settings are a person's). */
  ownerId: string;
  accountIds: string[];
  readOnly: boolean;
  /** Set when the company scope is displayed rather than a person's. */
  companyId?: string;
}

export async function getViewContext(): Promise<ViewContext> {
  const viewer = await getViewer();
  const requested = (await cookies()).get(VIEWING_PORTFOLIO_COOKIE)?.value;

  if (!requested || requested === viewer.id) {
    return { viewer, ownerId: viewer.id, accountIds: await baseAccountIds(viewer.id), readOnly: false };
  }

  if (requested.startsWith(COMPANY_SCOPE_PREFIX)) {
    return (await companyViewContext(viewer, requested.slice(COMPANY_SCOPE_PREFIX.length))) ?? {
      viewer, ownerId: viewer.id, accountIds: await baseAccountIds(viewer.id), readOnly: false,
    };
  }

  const grant = await prisma.portfolioGrant.findUnique({
    where: { grantorUserId_granteeUserId: { grantorUserId: requested, granteeUserId: viewer.id }, ...ACCEPTED },
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
 * A company displayed as a portfolio: its manager reads and writes it (they
 * own its accounts), an accepted associate reads it. Anyone else - or a
 * company that no longer exists, or a link not accepted yet - gets null and
 * falls back to their own portfolio, like a revoked grant.
 */
async function companyViewContext(viewer: Viewer, companyId: string): Promise<ViewContext | null> {
  let role: CompanyRole | null;
  try {
    role = await companyRole(viewer.id, companyId);
  } catch {
    return null; // a malformed cookie value is a stale selection, not an error
  }
  if (!role) return null;
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { managerUserId: true } });
  if (!company) return null;
  return {
    viewer,
    ownerId: company.managerUserId,
    accountIds: await companyAccountIds(companyId),
    readOnly: role !== "manager",
    companyId,
  };
}

/**
 * Ownership guard for mutations. Mirrors the existing assert*Eligible family
 * (assertManualAccountEligible, assertGoalAccountEligible, assertIncomeEventEligible,
 * assertHoldingHasTarget) and exists for the same documented reason: a Server
 * Action is directly invocable regardless of what the UI renders, so hiding a
 * button is never an access control.
 */
export async function assertAccountWritable(userId: string, accountId: string): Promise<void> {
  accountId = assertId(accountId);
  const [owned, coOwned] = await Promise.all([
    prisma.account.count({ where: { id: accountId, userId } }),
    prisma.accountCoOwner.count({ where: { accountId, userId, ...ACCEPTED } }),
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
  return { userId: viewer.id, accountIds: await writableAccountIds(viewer.id) };
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
  id = assertId(id);
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
  const ids = assertIds(transactionIds);
  if (ids.length === 0) return;
  const accountIds = await baseAccountIds(userId);
  const reachable = await prisma.transaction.count({
    where: { id: { in: ids }, accountId: { in: accountIds } },
  });
  if (reachable !== ids.length) throw new Error("Not found.");
}
