import { beforeEach, describe, expect, it, vi } from "vitest";

// v2.22: the type of a Woob-synced account, and accounts its sync must skip.
// Light coverage, per the lib/actions/* boundary (sonar-project.properties):
// what each action refuses and what it writes, with the access layer mocked
// (__tests__/auth-context.test.ts covers it).
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db, assertOwnedMock } = vi.hoisted(() => {
  const db = {
    account: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), delete: vi.fn() },
    ignoredSyncAccount: { upsert: vi.fn(), deleteMany: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: typeof db) => Promise<unknown>)(db) : Promise.all(arg as Promise<unknown>[]),
  );
  return { db, assertOwnedMock: vi.fn(async () => {}) };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth-context", () => ({
  getViewer: vi.fn(async () => ({ id: "user-owner", role: "ADMIN", isMonoMode: true })),
  assertOwned: assertOwnedMock,
  assertAccountWritable: vi.fn(async () => {}),
}));

import { setSyncedAccountType, stopSyncingAccount } from "@/lib/actions/accounts";
import { resumeSyncingAccount } from "@/lib/actions/institutions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function stored(type: string, syncId: string | null, latest: bigint | null = null) {
  db.account.findUniqueOrThrow.mockResolvedValue({
    type,
    syncId,
    history: latest === null ? [] : [{ balanceCents: latest }],
  });
}

/** The sign the balance rows were multiplied by, or null when they were left alone. */
function rowSign(): number | null {
  const call = db.$executeRaw.mock.calls[0];
  return call ? (call[1] as number) : null;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setSyncedAccountType", () => {
  it("makes a current account a loan: rows become what is owed, and its debt counts", async () => {
    stored("CHECKING", "woob:inst-1:credit", BigInt(150_000));
    await setSyncedAccountType(form({ id: "a1", type: "LOAN" }));

    expect(rowSign()).toBe(-1);
    expect(db.account.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { type: "LOAN", typeSetByUser: true, liabilityCents: BigInt(150_000) },
    });
  });

  it("reads a debt already stored negative as the same debt", async () => {
    stored("CHECKING", "lcl:pret", BigInt(-509_900));
    await setSyncedAccountType(form({ id: "a1", type: "LOAN" }));
    expect(db.account.update.mock.calls[0][0].data.liabilityCents).toBe(BigInt(509_900));
  });

  it("takes a loan back out: rows positive again, no debt left behind", async () => {
    stored("LOAN", "woob:inst-1:cc", BigInt(-25_000));
    await setSyncedAccountType(form({ id: "a1", type: "SAVINGS" }));

    expect(rowSign()).toBe(1);
    expect(db.account.update.mock.calls[0][0].data).toEqual({ type: "SAVINGS", typeSetByUser: true, liabilityCents: null });
  });

  it("leaves balances alone between two kinds of asset", async () => {
    stored("CHECKING", "woob:inst-1:livret");
    await setSyncedAccountType(form({ id: "a1", type: "SAVINGS" }));

    expect(rowSign()).toBeNull();
    expect(db.account.update.mock.calls[0][0].data).toEqual({ type: "SAVINGS", typeSetByUser: true });
  });

  it.each([["REAL_ESTATE"], ["AUTOMOBILE"], ["nonsense"]])("refuses %s, which no bank reports", async (type) => {
    stored("CHECKING", "woob:inst-1:x");
    await expect(setSyncedAccountType(form({ id: "a1", type }))).rejects.toThrow();
    expect(db.account.update).not.toHaveBeenCalled();
  });

  it.each([["tr:inst-1:cash"], [null]])("refuses an account the Woob sync does not own (%s)", async (syncId) => {
    stored("CHECKING", syncId);
    await expect(setSyncedAccountType(form({ id: "a1", type: "SAVINGS" }))).rejects.toThrow();
    expect(db.account.update).not.toHaveBeenCalled();
  });
});

describe("stopSyncingAccount", () => {
  it("remembers the bank's id under the institution, then deletes the account", async () => {
    db.account.findUnique.mockResolvedValue({ name: "COMPTE PRO", syncId: "woob:inst-1:pro", institutionId: "inst-1" });
    await stopSyncingAccount("a1");

    // The sync is the institution's: its owner decides, not a co-owner.
    expect(assertOwnedMock).toHaveBeenCalledWith("institution", "inst-1", "user-owner");
    expect(db.ignoredSyncAccount.upsert).toHaveBeenCalledWith({
      where: { institutionId_nativeId: { institutionId: "inst-1", nativeId: "pro" } },
      create: { institutionId: "inst-1", nativeId: "pro", name: "COMPTE PRO" },
      update: { name: "COMPTE PRO" },
    });
    expect(db.account.delete).toHaveBeenCalledWith({ where: { id: "a1" } });
  });

  it("deletes nothing when the viewer does not own the institution", async () => {
    db.account.findUnique.mockResolvedValue({ name: "X", syncId: "woob:inst-1:x", institutionId: "inst-1" });
    assertOwnedMock.mockRejectedValueOnce(new Error("Not found."));
    await expect(stopSyncingAccount("a1")).rejects.toThrow("Not found.");
    expect(db.account.delete).not.toHaveBeenCalled();
  });

  it.each([
    [{ name: "TR", syncId: "tr:inst-1:cash", institutionId: "inst-1" }],
    [{ name: "Manual", syncId: null, institutionId: "inst-1" }],
    [null],
  ])("refuses what the Woob sync would not skip (%o)", async (account) => {
    db.account.findUnique.mockResolvedValue(account);
    await expect(stopSyncingAccount("a1")).rejects.toThrow();
    expect(db.ignoredSyncAccount.upsert).not.toHaveBeenCalled();
    expect(db.account.delete).not.toHaveBeenCalled();
  });
});

describe("resumeSyncingAccount", () => {
  it("forgets the skip for that institution only, once its owner asks", async () => {
    await resumeSyncingAccount("inst-1", "pro");
    expect(assertOwnedMock).toHaveBeenCalledWith("institution", "inst-1", "user-owner");
    expect(db.ignoredSyncAccount.deleteMany).toHaveBeenCalledWith({ where: { institutionId: "inst-1", nativeId: "pro" } });
  });
});
