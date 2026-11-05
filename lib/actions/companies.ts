"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import {
  assertCompanyManager,
  assertOwned,
  companyAccountIds,
  companyRole,
  COMPANY_SCOPE_PREFIX,
  getViewer,
  VIEWING_PORTFOLIO_COOKIE,
} from "@/lib/auth-context";
import { assertId, assertOptionalId } from "@/lib/domain/action-input";
import { normalizeUsername } from "@/lib/domain/users";
import {
  parseBirthDate,
  validateCapTable,
  validateCompanyName,
  type CapTableError,
  type DismembermentRow,
} from "@/lib/domain/company";
import { CompanyKind, CompanyTaxRegime } from "@/app/generated/prisma/enums";

/**
 * Companies (SCI first) - every mutation, see dev-docs/companies.md.
 *
 * Only the company's MANAGER changes anything: every action below starts
 * with assertCompanyManager, which throws the same "Not found." for a missing
 * company, somebody else's, and one the caller is merely an associate of. The
 * one exception is respondToCompanyLink, which only ever touches the
 * caller's own associate row.
 *
 * Every argument is client-supplied and checked here, whatever the UI sends:
 * the cap table's invariant (parts add up to the total) in
 * lib/domain/company.ts, ids through assertId.
 */

export type CompanyFailure = {
  ok: false;
  error:
    | CapTableError
    | "kind_invalid"
    | "regime_invalid"
    | "no_such_user"
    | "self_twice"
    | "institution_account"
    | "co_owned"
    | "not_an_associate"
    | "name_conflict"
    | "discount_invalid"
    | "book_value_invalid";
};

type AssociateInput = {
  id?: string;
  name: string;
  parts: number;
  username?: string | null;
  self?: boolean;
  currentAccountCents?: number;
  birthDate?: string | null;
};

const KINDS = new Set<string>(Object.values(CompanyKind));
const REGIMES = new Set<string>(Object.values(CompanyTaxRegime));

type ResolvedAssociate = {
  id: string | null;
  name: string;
  parts: number;
  userId: string | null;
  /** The manager linking themselves: nobody else to ask. */
  acceptedNow: boolean;
  /** Checked by validateCapTable before anything is written. */
  currentAccountCents?: number;
  birthDate?: string | null;
};

/**
 * Client rows to associates, resolving a typed username to a user the same
 * way sharing does (one "no_such_user" whatever the name). A link to anyone
 * but the caller is an invitation: it grants nothing until accepted.
 */
async function resolveAssociates(
  viewerId: string,
  raw: unknown,
): Promise<{ ok: true; rows: ResolvedAssociate[] } | CompanyFailure> {
  if (!Array.isArray(raw)) return { ok: false, error: "no_associates" };
  const rows: ResolvedAssociate[] = [];
  let selfCount = 0;
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return { ok: false, error: "name_required" };
    const r = item as Record<string, unknown>;
    const named = validateCompanyName(r.name);
    if (!named.ok) return named;
    let userId: string | null = null;
    if (r.self === true) {
      userId = viewerId;
    } else if (typeof r.username === "string" && r.username.trim()) {
      const user = await prisma.user.findUnique({
        where: { username: normalizeUsername(r.username) },
        select: { id: true },
      });
      if (!user) return { ok: false, error: "no_such_user" };
      userId = user.id;
    }
    if (userId === viewerId && ++selfCount > 1) return { ok: false, error: "self_twice" };
    rows.push({
      id: assertOptionalId(r.id),
      name: named.name,
      parts: r.parts as number,
      userId,
      acceptedNow: userId === viewerId,
      currentAccountCents: r.currentAccountCents as number | undefined,
      birthDate: r.birthDate as string | null | undefined,
    });
  }
  return { ok: true, rows };
}

/**
 * The blocks of a cap table already checked by validateCapTable: one in full
 * ownership per associate holding parts that way, and one per démembrement,
 * its two sides given by their index in `associateIds`.
 */
function holdingRows(
  companyId: string,
  rows: ResolvedAssociate[],
  associateIds: string[],
  dismemberments: DismembermentRow[],
) {
  return [
    ...rows.flatMap((row, i) => (row.parts > 0 ? [{ companyId, parts: row.parts, fullOwnerId: associateIds[i] }] : [])),
    ...dismemberments.map((d) => ({
      companyId,
      parts: d.parts,
      usufructuaryId: associateIds[d.usufructuary],
      bareOwnerId: associateIds[d.bareOwner],
    })),
  ];
}

const birthDateOf = (row: ResolvedAssociate) => parseBirthDate(row.birthDate);

function validateKindAndRegime(kind: unknown, taxRegime: unknown): CompanyFailure | null {
  if (typeof kind !== "string" || !KINDS.has(kind)) return { ok: false, error: "kind_invalid" };
  if (typeof taxRegime !== "string" || !REGIMES.has(taxRegime)) return { ok: false, error: "regime_invalid" };
  return null;
}

export async function createCompany(input: {
  name: string;
  kind: string;
  taxRegime: string;
  totalParts: number;
  associates: AssociateInput[];
  dismemberments?: DismembermentRow[];
}): Promise<{ ok: true; companyId: string } | CompanyFailure> {
  const viewer = await getViewer();
  const named = validateCompanyName(input?.name);
  if (!named.ok) return named;
  const invalid = validateKindAndRegime(input.kind, input.taxRegime);
  if (invalid) return invalid;
  const resolved = await resolveAssociates(viewer.id, input.associates);
  if (!resolved.ok) return resolved;
  const dismemberments = input.dismemberments ?? [];
  const capTableError = validateCapTable(input.totalParts, resolved.rows, dismemberments);
  if (capTableError) return { ok: false, error: capTableError };

  const company = await prisma.$transaction(async (tx) => {
    const created = await tx.company.create({
      data: {
        name: named.name,
        kind: input.kind as CompanyKind,
        taxRegime: input.taxRegime as CompanyTaxRegime,
        totalParts: input.totalParts,
        managerUserId: viewer.id,
      },
    });
    const associateIds: string[] = [];
    for (const row of resolved.rows) {
      const associate = await tx.companyAssociate.create({
        data: {
          companyId: created.id,
          name: row.name,
          userId: row.userId,
          linkAcceptedAt: row.acceptedNow ? new Date() : null,
          currentAccountCents: BigInt(row.currentAccountCents ?? 0),
          birthDate: birthDateOf(row),
        },
      });
      associateIds.push(associate.id);
    }
    for (const data of holdingRows(created.id, resolved.rows, associateIds, dismemberments)) {
      await tx.companyHolding.create({ data });
    }
    return created;
  });
  revalidatePath("/", "layout");
  return { ok: true, companyId: company.id };
}

export async function updateCompany(
  companyId: string,
  input: { name: string; kind: string; taxRegime: string; discountPct?: number | null },
): Promise<{ ok: true } | CompanyFailure> {
  companyId = assertId(companyId);
  const viewer = await getViewer();
  await assertCompanyManager(viewer.id, companyId);
  const named = validateCompanyName(input?.name);
  if (!named.ok) return named;
  const invalid = validateKindAndRegime(input.kind, input.taxRegime);
  if (invalid) return invalid;
  // An illiquidity discount on the parts (step 3): a ratio, 0 included, under
  // 1. Absent or null means none.
  const discount = input.discountPct ?? null;
  if (discount !== null && (typeof discount !== "number" || !Number.isFinite(discount) || discount < 0 || discount >= 1)) {
    return { ok: false, error: "discount_invalid" };
  }
  await prisma.company.update({
    where: { id: companyId },
    data: {
      name: named.name,
      kind: input.kind as CompanyKind,
      taxRegime: input.taxRegime as CompanyTaxRegime,
      discountPct: discount === 0 ? null : discount,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Replaces the cap table as a whole: total parts, associates and their
 * parts, in one transaction, so the invariant holds before and after and
 * never in between. A row that keeps its id keeps its accepted link when the
 * linked user does not change; a new or changed link starts pending again.
 */
export async function saveCapTable(
  companyId: string,
  input: {
    totalParts: number;
    associates: AssociateInput[];
    dismemberments?: DismembermentRow[];
  },
): Promise<{ ok: true } | CompanyFailure> {
  companyId = assertId(companyId);
  const viewer = await getViewer();
  await assertCompanyManager(viewer.id, companyId);
  const resolved = await resolveAssociates(viewer.id, input?.associates);
  if (!resolved.ok) return resolved;
  const dismemberments = input.dismemberments ?? [];
  const capTableError = validateCapTable(input.totalParts, resolved.rows, dismemberments);
  if (capTableError) return { ok: false, error: capTableError };

  const existing = await prisma.companyAssociate.findMany({
    where: { companyId },
    select: { id: true, userId: true, linkAcceptedAt: true },
  });
  const byId = new Map(existing.map((a) => [a.id, a]));
  // An id from another company (or none at all) is not this cap table's row.
  for (const row of resolved.rows) if (row.id && !byId.has(row.id)) throw new Error("Not found.");
  const keptIds = resolved.rows.flatMap((r) => (r.id ? [r.id] : []));

  await prisma.$transaction(async (tx) => {
    await tx.companyHolding.deleteMany({ where: { companyId } });
    await tx.companyAssociate.deleteMany({ where: { companyId, id: { notIn: keptIds } } });
    // Unlink every kept row first: two rows swapping users would otherwise
    // trip the (companyId, userId) unique index halfway through.
    await tx.companyAssociate.updateMany({ where: { companyId, id: { in: keptIds } }, data: { userId: null } });
    const associateIds: string[] = [];
    for (const row of resolved.rows) {
      const previous = row.id ? byId.get(row.id) : undefined;
      const sameLink = previous !== undefined && previous.userId === row.userId;
      let linkAcceptedAt: Date | null = null;
      if (row.acceptedNow) linkAcceptedAt = previous?.linkAcceptedAt ?? new Date();
      else if (sameLink) linkAcceptedAt = previous.linkAcceptedAt;
      const data = {
        name: row.name,
        userId: row.userId,
        linkAcceptedAt,
        currentAccountCents: BigInt(row.currentAccountCents ?? 0),
        birthDate: birthDateOf(row),
      };
      const associate = row.id
        ? await tx.companyAssociate.update({ where: { id: row.id }, data })
        : await tx.companyAssociate.create({ data: { ...data, companyId } });
      associateIds.push(associate.id);
    }
    for (const data of holdingRows(companyId, resolved.rows, associateIds, dismemberments)) {
      await tx.companyHolding.create({ data });
    }
    await tx.company.update({ where: { id: companyId }, data: { totalParts: input.totalParts } });
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * The linked user's answer: accept, or decline - which also serves to leave
 * a company accepted earlier. Declining unlinks the row but keeps the name
 * and the parts, so the cap table still adds up; only the manager edits it.
 * Only ever the caller's own row, and only a literal `true` is consent.
 */
export async function respondToCompanyLink(associateId: string, accept: boolean): Promise<void> {
  associateId = assertId(associateId);
  const viewer = await getViewer();
  const { count } =
    accept === true
      ? await prisma.companyAssociate.updateMany({
          where: { id: associateId, userId: viewer.id, linkAcceptedAt: null },
          data: { linkAcceptedAt: new Date() },
        })
      : await prisma.companyAssociate.updateMany({
          where: { id: associateId, userId: viewer.id },
          data: { userId: null, linkAcceptedAt: null },
        });
  if (count === 0) throw new Error("Not found.");
  revalidatePath("/", "layout");
}

/**
 * Moves one of the manager's own accounts into a company (or back out). Not
 * for an account under a bank connection: the institution and its accounts
 * move together (setInstitutionCompany), so the two never disagree. Not for a
 * co-owned account either - the co-owner would keep counting it at 100 %.
 */
export async function setAccountCompany(accountId: string, companyId: string | null): Promise<{ ok: true } | CompanyFailure> {
  accountId = assertId(accountId);
  const target = assertOptionalId(companyId);
  const viewer = await getViewer();
  const account = await prisma.account.findFirst({
    where: { id: accountId, userId: viewer.id },
    select: { companyId: true, institutionId: true, _count: { select: { coOwners: true } } },
  });
  if (!account) throw new Error("Not found.");
  if (account.companyId) await assertCompanyManager(viewer.id, account.companyId);
  if (target) await assertCompanyManager(viewer.id, target);
  if (account.institutionId) return { ok: false, error: "institution_account" };
  if (account._count.coOwners > 0) return { ok: false, error: "co_owned" };

  await prisma.account.update({ where: { id: accountId }, data: { companyId: target } });
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * A company building's net book value (step 4) - cost less depreciation, from
 * the balance sheet - which its latent gain under corporate tax is measured
 * from. Only a REAL_ESTATE account of a company, only by its manager; null
 * clears it (the building then has no measurable gain).
 */
export async function setBuildingBookValue(
  accountId: string,
  bookValueCents: number | null,
): Promise<{ ok: true } | CompanyFailure> {
  accountId = assertId(accountId);
  const viewer = await getViewer();
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { companyId: true, type: true } });
  if (!account?.companyId || account.type !== "REAL_ESTATE") throw new Error("Not found.");
  await assertCompanyManager(viewer.id, account.companyId);
  if (
    bookValueCents !== null &&
    (typeof bookValueCents !== "number" || !Number.isSafeInteger(bookValueCents) || bookValueCents < 0)
  ) {
    return { ok: false, error: "book_value_invalid" };
  }
  await prisma.account.update({
    where: { id: accountId },
    data: { bookValueCents: bookValueCents === null ? null : BigInt(bookValueCents) },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** A bank connection and every account under it, into a company or out of it. */
export async function setInstitutionCompany(
  institutionId: string,
  companyId: string | null,
): Promise<{ ok: true } | CompanyFailure> {
  institutionId = assertId(institutionId);
  const target = assertOptionalId(companyId);
  const viewer = await getViewer();
  await assertOwned("institution", institutionId, viewer.id);
  const institution = await prisma.institution.findUnique({ where: { id: institutionId }, select: { companyId: true } });
  if (institution?.companyId) await assertCompanyManager(viewer.id, institution.companyId);
  if (target) await assertCompanyManager(viewer.id, target);
  if ((await prisma.accountCoOwner.count({ where: { account: { institutionId } } })) > 0) {
    return { ok: false, error: "co_owned" };
  }

  await prisma.$transaction([
    prisma.institution.update({ where: { id: institutionId }, data: { companyId: target } }),
    prisma.account.updateMany({ where: { institutionId }, data: { companyId: target } }),
  ]);
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Hands management to a linked associate who accepted. Their accounts and
 * bank connections move with it, in one transaction - the sync attributes
 * from the institution's owner, so it follows on its own. The previous
 * manager's alert rules and goals on those accounts go: they would keep
 * pointing at accounts that are no longer theirs.
 */
export async function transferCompanyManagement(
  companyId: string,
  associateId: string,
): Promise<{ ok: true } | CompanyFailure> {
  companyId = assertId(companyId);
  associateId = assertId(associateId);
  const viewer = await getViewer();
  await assertCompanyManager(viewer.id, companyId);
  const next = await prisma.companyAssociate.findFirst({
    where: { id: associateId, companyId, linkAcceptedAt: { not: null }, userId: { not: null } },
    select: { userId: true },
  });
  if (!next?.userId || next.userId === viewer.id) return { ok: false, error: "not_an_associate" };
  const nextUserId = next.userId;
  const accountIds = await companyAccountIds(companyId);

  try {
    await prisma.$transaction([
      prisma.company.update({ where: { id: companyId }, data: { managerUserId: nextUserId } }),
      prisma.institution.updateMany({ where: { companyId }, data: { userId: nextUserId } }),
      prisma.account.updateMany({ where: { companyId }, data: { userId: nextUserId } }),
      prisma.alertRule.deleteMany({ where: { userId: viewer.id, accountId: { in: accountIds } } }),
      prisma.goal.deleteMany({ where: { userId: viewer.id, accountId: { in: accountIds } } }),
    ]);
  } catch (e) {
    // Institution names are unique per user: the new manager already has a
    // connection by the same name. Nothing moved (one transaction).
    if ((e as { code?: string }).code === "P2002") return { ok: false, error: "name_conflict" };
    throw e;
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Deletes the company and its cap table. Its accounts and bank connections
 * stay, back in the manager's own portfolio - the UI says so before asking.
 */
export async function deleteCompany(companyId: string): Promise<void> {
  companyId = assertId(companyId);
  const viewer = await getViewer();
  await assertCompanyManager(viewer.id, companyId);
  await prisma.$transaction([
    prisma.account.updateMany({ where: { companyId }, data: { companyId: null } }),
    prisma.institution.updateMany({ where: { companyId }, data: { companyId: null } }),
    prisma.company.delete({ where: { id: companyId } }),
  ]);
  revalidatePath("/", "layout");
}

/**
 * Shows a company as a portfolio (the pages' scope, see getViewContext).
 * Checked here as well as on every read, so a value nobody may use is never
 * stored. null goes back to the viewer's own portfolio.
 */
export async function setViewingCompany(companyId: string | null): Promise<void> {
  const viewer = await getViewer();
  const jar = await cookies();
  if (companyId === null) {
    jar.delete(VIEWING_PORTFOLIO_COOKIE);
  } else {
    companyId = assertId(companyId);
    if (!(await companyRole(viewer.id, companyId))) throw new Error("Not found.");
    jar.set(VIEWING_PORTFOLIO_COOKIE, `${COMPANY_SCOPE_PREFIX}${companyId}`, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
  }
  revalidatePath("/", "layout");
}
