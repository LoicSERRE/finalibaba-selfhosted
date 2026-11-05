import { beforeEach, describe, expect, it } from "vitest";
import { parseChange, settleVersions, targetVersionId, type CapTableChange } from "@/lib/services/cap-table-versions";
import { CAP_TABLE_ORIGIN } from "@/lib/domain/company";

// lib/services/cap-table-versions.ts against an in-memory stand-in for the
// two tables it shapes - only the queries it makes, so what is checked is
// the versions it leaves behind, not the calls it happens to make.

type Version = { id: string; companyId: string; effectiveFrom: Date; totalParts: number; kind: string };
type Holding = { companyId: string; versionId: string; parts: number; fullOwnerId: string | null; usufructuaryId: string | null; bareOwnerId: string | null };

const C = "co-1";
let versions: Version[];
let holdings: Holding[];
let seq: number;
const calls: { model: string; method: string; arg: unknown }[] = [];

type Where = { companyId: string; effectiveFrom?: { lt?: Date; lte?: Date } };
type FindArgs = { where: Where; orderBy?: { effectiveFrom: "asc" | "desc" }; select?: { holdings?: unknown } };

function withHoldings(v: Version, select?: FindArgs["select"]) {
  if (!select?.holdings) return { ...v };
  return {
    ...v,
    holdings: holdings
      .filter((h) => h.versionId === v.id)
      .map(({ parts, fullOwnerId, usufructuaryId, bareOwnerId }) => ({ parts, fullOwnerId, usufructuaryId, bareOwnerId })),
  };
}

const versionStore = {
  findFirst: async ({ where, orderBy, select }: FindArgs) => {
    const rows = versions
      .filter((v) => v.companyId === where.companyId)
      .filter((v) => !where.effectiveFrom?.lt || v.effectiveFrom < where.effectiveFrom.lt)
      .filter((v) => !where.effectiveFrom?.lte || v.effectiveFrom <= where.effectiveFrom.lte)
      .sort((a, b) => (orderBy?.effectiveFrom === "desc" ? -1 : 1) * (a.effectiveFrom.getTime() - b.effectiveFrom.getTime()));
    return rows[0] ? withHoldings(rows[0], select) : null;
  },
  findUnique: async ({ where }: { where: { companyId_effectiveFrom: { companyId: string; effectiveFrom: Date } } }) => {
    const k = where.companyId_effectiveFrom;
    return versions.find((v) => v.companyId === k.companyId && v.effectiveFrom.getTime() === k.effectiveFrom.getTime()) ?? null;
  },
  create: async ({ data }: { data: Omit<Version, "id"> }) => {
    const v = { id: `v${++seq}`, ...data };
    versions.push(v);
    return v;
  },
  update: async ({ where, data }: { where: { id: string }; data: Partial<Version> }) => {
    const v = versions.find((x) => x.id === where.id)!;
    Object.assign(v, data);
    return v;
  },
  upsert: async ({ where, create, update }: { where: { companyId_effectiveFrom: { companyId: string; effectiveFrom: Date } }; create: Omit<Version, "id">; update: Partial<Version> }) => {
    const found = await versionStore.findUnique({ where });
    if (found) return versionStore.update({ where: { id: found.id }, data: update });
    return versionStore.create({ data: create });
  },
};

const tx = {
  companyCapTableVersion: versionStore,
  companyHolding: {
    create: async ({ data }: { data: Holding }) => {
      holdings.push(data);
      return data;
    },
  },
  company: { update: async (arg: unknown) => calls.push({ model: "company", method: "update", arg }) },
  companyAssociate: {
    updateMany: async (arg: unknown) => calls.push({ model: "associate", method: "updateMany", arg }),
    deleteMany: async (arg: unknown) => calls.push({ model: "associate", method: "deleteMany", arg }),
  },
} as unknown as Parameters<typeof targetVersionId>[0];

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const hold = (versionId: string, fullOwnerId: string, parts: number): Holding => ({
  companyId: C, versionId, parts, fullOwnerId, usufructuaryId: null, bareOwnerId: null,
});
const partsOf = (versionId: string) =>
  Object.fromEntries(holdings.filter((h) => h.versionId === versionId).map((h) => [h.fullOwnerId, h.parts]));
const dated = () =>
  [...versions].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime()).map((v) => [v.effectiveFrom.toISOString().slice(0, 10), v.kind]);
const change = (kind: CapTableChange["kind"], iso: string, enteredAs: CapTableChange["enteredAs"]): CapTableChange => ({
  kind, effectiveFrom: day(iso), enteredAs,
});

beforeEach(() => {
  seq = 0;
  calls.length = 0;
  // A company entered with Camille holding everything, since the origin.
  versions = [{ id: "origin", companyId: C, effectiveFrom: CAP_TABLE_ORIGIN, totalParts: 1000, kind: "CREATION" }];
  holdings = [hold("origin", "camille", 1000)];
});

describe("targetVersionId", () => {
  it("corrects the version in force today, whatever its date", async () => {
    versions.push({ id: "june", companyId: C, effectiveFrom: day("2026-06-01"), totalParts: 1000, kind: "DONATION" });
    await expect(targetVersionId(tx, C, null, 2000)).resolves.toBe("june");
    expect(versions.find((v) => v.id === "june")).toMatchObject({ totalParts: 2000, kind: "DONATION" });
  });

  it("starts a version on the day of a change recorded as it happens", async () => {
    const id = await targetVersionId(tx, C, change("CESSION", "2026-06-01", "after"), 1000);
    expect(dated()).toEqual([["1900-01-01", "CREATION"], ["2026-06-01", "CESSION"]]);
    expect(id).toBe(versions.find((v) => v.effectiveFrom.getTime() === day("2026-06-01").getTime())!.id);
  });

  it("rewrites the version of that day if there is one already", async () => {
    versions.push({ id: "june", companyId: C, effectiveFrom: day("2026-06-01"), totalParts: 1000, kind: "CESSION" });
    await expect(targetVersionId(tx, C, change("DONATION", "2026-06-01", "after"), 500)).resolves.toBe("june");
    expect(versions).toHaveLength(2);
    expect(versions[1]).toMatchObject({ kind: "DONATION", totalParts: 500 });
  });

  it("fills in the past: today's parts from the day, the ones entered before it", async () => {
    // Entered today as Camille 500 / Léo 500; it was all Camille's until a donation in June.
    holdings = [hold("origin", "camille", 500), hold("origin", "leo", 500)];
    const id = await targetVersionId(tx, C, change("DONATION", "2026-06-01", "before"), 1000);
    expect(id).toBe("origin"); // the caller writes the parts entered into it
    expect(dated()).toEqual([["1900-01-01", "CREATION"], ["2026-06-01", "DONATION"]]);
    const june = versions.find((v) => v.kind === "DONATION")!;
    expect(partsOf(june.id)).toEqual({ camille: 500, leo: 500 });
  });

  it("only changes the kind of a version that already starts on that day", async () => {
    versions.push({ id: "june", companyId: C, effectiveFrom: day("2026-06-01"), totalParts: 1000, kind: "CESSION" });
    holdings.push(hold("june", "leo", 1000));
    await expect(targetVersionId(tx, C, change("DONATION", "2026-06-01", "before"), 800)).resolves.toBe("origin");
    expect(versions).toHaveLength(2);
    expect(versions.find((v) => v.id === "june")!.kind).toBe("DONATION");
    expect(partsOf("june")).toEqual({ leo: 1000 });
    expect(versions.find((v) => v.id === "origin")!.totalParts).toBe(800);
  });

  it("splits the version that covered the day, leaving the ones after it alone", async () => {
    versions.push({ id: "2025", companyId: C, effectiveFrom: day("2025-01-01"), totalParts: 1000, kind: "CESSION" });
    holdings.push(hold("2025", "marie", 1000));
    versions.push({ id: "2026", companyId: C, effectiveFrom: day("2026-09-01"), totalParts: 1000, kind: "DONATION" });
    holdings.push(hold("2026", "leo", 1000));
    await expect(targetVersionId(tx, C, change("CESSION", "2025-06-01", "before"), 1000)).resolves.toBe("2025");
    expect(dated().map((d) => d[0])).toEqual(["1900-01-01", "2025-01-01", "2025-06-01", "2026-09-01"]);
    const split = versions.find((v) => v.effectiveFrom.getTime() === day("2025-06-01").getTime())!;
    expect(partsOf(split.id)).toEqual({ marie: 1000 }); // what was in force on the day carries on
    expect(partsOf("2026")).toEqual({ leo: 1000 });
  });

  it("gives a company with nothing before the day a new origin", async () => {
    versions = [{ id: "2025", companyId: C, effectiveFrom: day("2025-03-01"), totalParts: 1000, kind: "CESSION" }];
    holdings = [hold("2025", "marie", 1000)];
    const id = await targetVersionId(tx, C, change("DONATION", "2025-01-01", "before"), 1000);
    expect(versions.find((v) => v.id === id)).toMatchObject({ effectiveFrom: CAP_TABLE_ORIGIN, kind: "CREATION" });
    const boundary = versions.find((v) => v.effectiveFrom.getTime() === day("2025-01-01").getTime())!;
    expect(partsOf(boundary.id)).toEqual({ marie: 1000 });
  });
});

describe("parseChange", () => {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

  it("reads no change as a correction", () => {
    expect(parseChange(undefined)).toEqual({ ok: true, change: null });
    expect(parseChange(null)).toEqual({ ok: true, change: null });
  });

  it("takes a dated change, after it unless told before", () => {
    expect(parseChange({ kind: "CESSION", effectiveFrom: today })).toEqual({
      ok: true, change: { kind: "CESSION", effectiveFrom: day(today), enteredAs: "after" },
    });
    expect(parseChange({ kind: "DONATION", effectiveFrom: "2025-03-01", enteredAs: "before" })).toMatchObject({
      change: { enteredAs: "before" },
    });
  });

  it.each([["CREATION"], ["CORRECTION"], ["THEFT"], [undefined], [{ in: ["CESSION"] }]])("refuses %s as a kind", (kind) => {
    expect(parseChange({ kind, effectiveFrom: "2025-03-01" })).toEqual({ ok: false, error: "change_kind_invalid" });
  });

  it.each([[tomorrow], ["2025-02-30"], ["1900-01-01"], ["soon"], [{ gte: "2020-01-01" }], [undefined]])("refuses %s as a date", (effectiveFrom) => {
    expect(parseChange({ kind: "CESSION", effectiveFrom })).toEqual({ ok: false, error: "effective_date_invalid" });
  });

  it("refuses something that is not an object", () => {
    expect(parseChange("CESSION")).toEqual({ ok: false, error: "change_kind_invalid" });
  });
});

describe("settleVersions", () => {
  it("mirrors today's total, clears the leavers' current accounts and drops whoever no version names", async () => {
    versions.push({ id: "june", companyId: C, effectiveFrom: day("2026-06-01"), totalParts: 2000, kind: "CAPITAL_CHANGE" });
    await settleVersions(tx, C);
    const inJune = { some: { versionId: "june" } };
    expect(calls).toEqual([
      { model: "company", method: "update", arg: { where: { id: C }, data: { totalParts: 2000 } } },
      {
        model: "associate",
        method: "updateMany",
        arg: {
          where: { companyId: C, NOT: { OR: [{ holdings: inJune }, { usufructs: inJune }, { bareOwnerships: inJune }] } },
          data: { currentAccountCents: BigInt(0) },
        },
      },
      {
        model: "associate",
        method: "deleteMany",
        arg: { where: { companyId: C, holdings: { none: {} }, usufructs: { none: {} }, bareOwnerships: { none: {} } } },
      },
    ]);
  });
});
