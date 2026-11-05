import type { prisma } from "@/lib/db/prisma";
import type { CapTableChangeKind } from "@/app/generated/prisma/enums";
import { CAP_TABLE_ORIGIN, parseBirthDate } from "@/lib/domain/company";

/**
 * Which dated cap table a save writes into (dev-docs/companies.md, step 5).
 * A plain module, not a "use server" one: lib/actions/companies.ts calls it
 * inside its transaction, after it has checked the caller manages the company.
 */

type Tx = Pick<typeof prisma, "companyCapTableVersion" | "companyHolding" | "companyAssociate" | "company">;

/** A dated change: what happened, from when, and which side of it the parts entered are. */
export interface CapTableChange {
  kind: Exclude<CapTableChangeKind, "CREATION" | "CORRECTION">;
  effectiveFrom: Date;
  /** "after": the cap table from that day on (a change as it happens).
   *  "before": the one until that day (filling in the past). */
  enteredAs: "after" | "before";
}

const DATED_KINDS = new Set(["CESSION", "DONATION", "CAPITAL_CHANGE"]);

export type ChangeError = "change_kind_invalid" | "effective_date_invalid";

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * The client's change, checked: absent is a correction of the cap table in
 * force (null). A date is a real day after the origin and never in the
 * future - a cession to come is not a fact yet.
 */
export function parseChange(raw: unknown): { ok: true; change: CapTableChange | null } | { ok: false; error: ChangeError } {
  if (raw === undefined || raw === null) return { ok: true, change: null };
  const input = raw as { kind?: unknown; effectiveFrom?: unknown; enteredAs?: unknown };
  if (typeof input !== "object" || typeof input.kind !== "string" || !DATED_KINDS.has(input.kind)) {
    return { ok: false, error: "change_kind_invalid" };
  }
  const day = parseBirthDate(input.effectiveFrom); // a real "YYYY-MM-DD" day, 1900 to 2100
  if (!day || day.getTime() <= CAP_TABLE_ORIGIN.getTime() || day.getTime() > todayUtc().getTime()) {
    return { ok: false, error: "effective_date_invalid" };
  }
  return {
    ok: true,
    change: { kind: input.kind as CapTableChange["kind"], effectiveFrom: day, enteredAs: input.enteredAs === "before" ? "before" : "after" },
  };
}

/** The version in force today: the latest started, else the earliest. */
async function currentVersion(tx: Tx, companyId: string) {
  return (
    (await tx.companyCapTableVersion.findFirst({
      where: { companyId, effectiveFrom: { lte: new Date() } },
      orderBy: { effectiveFrom: "desc" },
      select: { id: true, totalParts: true },
    })) ??
    tx.companyCapTableVersion.findFirst({ where: { companyId }, orderBy: { effectiveFrom: "asc" }, select: { id: true, totalParts: true } })
  );
}

const HOLDING_COPY = { parts: true, fullOwnerId: true, usufructuaryId: true, bareOwnerId: true } as const;

/**
 * "These were the parts until D": D becomes a version boundary - a version
 * starting on D with what was in force on D, if none starts then - and the
 * version just before D takes the parts entered. With nothing before D, a
 * new origin version does.
 */
async function versionBefore(tx: Tx, companyId: string, change: CapTableChange, totalParts: number): Promise<string> {
  const day = change.effectiveFrom;
  const prev = await tx.companyCapTableVersion.findFirst({
    where: { companyId, effectiveFrom: { lt: day } },
    orderBy: { effectiveFrom: "desc" },
    select: { id: true, totalParts: true, holdings: { select: HOLDING_COPY } },
  });
  const atDay = await tx.companyCapTableVersion.findUnique({
    where: { companyId_effectiveFrom: { companyId, effectiveFrom: day } },
    select: { id: true },
  });
  if (atDay) {
    await tx.companyCapTableVersion.update({ where: { id: atDay.id }, data: { kind: change.kind } });
  } else {
    const source =
      prev ??
      (await tx.companyCapTableVersion.findFirst({
        where: { companyId },
        orderBy: { effectiveFrom: "asc" },
        select: { id: true, totalParts: true, holdings: { select: HOLDING_COPY } },
      }));
    if (!source) throw new Error("Not found.");
    const boundary = await tx.companyCapTableVersion.create({
      data: { companyId, effectiveFrom: day, totalParts: source.totalParts, kind: change.kind },
    });
    for (const h of source.holdings) {
      await tx.companyHolding.create({ data: { ...h, companyId, versionId: boundary.id } });
    }
  }
  if (prev) {
    await tx.companyCapTableVersion.update({ where: { id: prev.id }, data: { totalParts } });
    return prev.id;
  }
  const origin = await tx.companyCapTableVersion.create({
    data: { companyId, effectiveFrom: CAP_TABLE_ORIGIN, totalParts, kind: "CREATION" },
  });
  return origin.id;
}

/**
 * The version whose parts a save replaces. A correction: the one in force
 * today, its kind kept. A change "after": the version starting that day,
 * created if needed. A change "before": see versionBefore.
 */
export async function targetVersionId(tx: Tx, companyId: string, change: CapTableChange | null, totalParts: number): Promise<string> {
  if (!change) {
    const current = await currentVersion(tx, companyId);
    if (!current) throw new Error("Not found.");
    await tx.companyCapTableVersion.update({ where: { id: current.id }, data: { totalParts } });
    return current.id;
  }
  if (change.enteredAs === "before") return versionBefore(tx, companyId, change, totalParts);
  const version = await tx.companyCapTableVersion.upsert({
    where: { companyId_effectiveFrom: { companyId, effectiveFrom: change.effectiveFrom } },
    create: { companyId, effectiveFrom: change.effectiveFrom, totalParts, kind: change.kind },
    update: { totalParts, kind: change.kind },
  });
  return version.id;
}

/**
 * After any change of versions: Company.totalParts mirrors the one in force
 * today; whoever it does not name holds no current account today (current
 * accounts are not dated - one is repaid on exit); an associate no version
 * names any more is gone.
 */
export async function settleVersions(tx: Tx, companyId: string): Promise<void> {
  const current = await currentVersion(tx, companyId);
  if (!current) return;
  await tx.company.update({ where: { id: companyId }, data: { totalParts: current.totalParts } });
  const inCurrent = { some: { versionId: current.id } };
  await tx.companyAssociate.updateMany({
    where: { companyId, NOT: { OR: [{ holdings: inCurrent }, { usufructs: inCurrent }, { bareOwnerships: inCurrent }] } },
    data: { currentAccountCents: BigInt(0) },
  });
  await tx.companyAssociate.deleteMany({
    where: { companyId, holdings: { none: {} }, usufructs: { none: {} }, bareOwnerships: { none: {} } },
  });
}
