import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Light coverage only, per this project's stated lib/actions/* boundary (see
// sonar-project.properties' sonar.coverage.exclusions comment) - error paths
// and the success data shape, same convention as totp-actions.test.ts. This
// file exists because lib/actions/institutions.ts is where the real LCL/Woob
// duplicate-account incident (and its history-depth-loss follow-up) lived -
// see CLAUDE.md's "Migrating an existing dedicated integration to Woob".
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const {
  institutionCreateMock,
  institutionUpdateMock,
  institutionDeleteMock,
  institutionFindUniqueMock,
  accountCountMock,
  accountFindManyMock,
  accountDeleteManyMock,
  transactionFindFirstMock,
  historicalBalanceFindFirstMock,
} = vi.hoisted(() => ({
  institutionCreateMock: vi.fn(),
  institutionUpdateMock: vi.fn(),
  institutionDeleteMock: vi.fn(),
  institutionFindUniqueMock: vi.fn(),
  accountCountMock: vi.fn(),
  accountFindManyMock: vi.fn(),
  accountDeleteManyMock: vi.fn(),
  transactionFindFirstMock: vi.fn(),
  historicalBalanceFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    institution: {
      create: institutionCreateMock,
      update: institutionUpdateMock,
      delete: institutionDeleteMock,
      findUnique: institutionFindUniqueMock,
    },
    account: {
      count: accountCountMock,
      findMany: accountFindManyMock,
      deleteMany: accountDeleteManyMock,
    },
    transaction: { findFirst: transactionFindFirstMock },
    historicalBalance: { findFirst: historicalBalanceFindFirstMock },
  },
}));

vi.mock("@/lib/auth-context", () => ({
  // These tests exercise this action file's own logic (validation, write
  // shape), not the multi-user access layer - which has its own coverage in
  // __tests__/auth-context.test.ts. Mocking the guards to always pass keeps
  // each test asserting the thing it was written to assert.
  getViewer: vi.fn(async () => ({ id: "user-owner", role: "ADMIN", isMonoMode: true })),
  assertOwned: vi.fn(async () => {}),
  assertAccountWritable: vi.fn(async () => {}),
  assertTransactionsWritable: vi.fn(async () => {}),
  baseAccountIds: vi.fn(async () => []),
  viewAccountIds: vi.fn(async () => []),
}));

import {
  createInstitution,
  clearGocardlessConnection,
  getMigrationHistoryDepth,
  migrateDedicatedSyncToWoob,
} from "@/lib/actions/institutions";

beforeEach(() => {
  institutionCreateMock.mockReset().mockResolvedValue({});
  institutionUpdateMock.mockReset().mockResolvedValue({});
  institutionDeleteMock.mockReset().mockResolvedValue({});
  institutionFindUniqueMock.mockReset();
  accountCountMock.mockReset();
  accountFindManyMock.mockReset().mockResolvedValue([]);
  accountDeleteManyMock.mockReset().mockResolvedValue({ count: 0 });
  transactionFindFirstMock.mockReset().mockResolvedValue(null);
  historicalBalanceFindFirstMock.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

describe("createInstitution", () => {
  it("throws when the name is blank", async () => {
    await expect(createInstitution(formData({ name: "  " }))).rejects.toThrow("Name required");
    expect(institutionCreateMock).not.toHaveBeenCalled();
  });

  // Every assertion here includes userId: the create passes it explicitly
  // rather than leaning on the column's DB-level default, which exists only
  // so sync/db.py's raw SQL keeps working - app-side writes must always say
  // who they belong to (see schema.prisma's v2.0 header).
  it("trims the name and creates without Woob fields when they're absent", async () => {
    await createInstitution(formData({ name: "  LCL  " }));
    expect(institutionCreateMock).toHaveBeenCalledWith({ data: { userId: "user-owner", name: "LCL" } });
  });

  it("only attaches Woob credentials when module, login, AND password are all present", async () => {
    await createInstitution(formData({ name: "LCL", woobModule: "lcl", woobLogin: "user" }));
    expect(institutionCreateMock).toHaveBeenCalledWith({ data: { userId: "user-owner", name: "LCL" } });

    institutionCreateMock.mockClear();
    await createInstitution(
      formData({ name: "LCL", woobModule: "lcl", woobLogin: "user", woobPassword: "pw" }),
    );
    expect(institutionCreateMock).toHaveBeenCalledWith({
      data: { userId: "user-owner", name: "LCL", woobModule: "lcl", woobLogin: "user", woobPassword: "pw" },
    });
  });
});

describe("clearGocardlessConnection", () => {
  it("throws when the institution already has a real GoCardless-synced account", async () => {
    accountCountMock.mockResolvedValueOnce(1);
    await expect(clearGocardlessConnection("inst-1")).rejects.toThrow(
      "Cannot disconnect: this institution already has GoCardless-synced accounts",
    );
    expect(institutionUpdateMock).not.toHaveBeenCalled();
  });

  it("clears the dangling link when no account is actually GoCardless-synced", async () => {
    accountCountMock.mockResolvedValueOnce(0);
    await clearGocardlessConnection("inst-1");
    expect(institutionUpdateMock).toHaveBeenCalledWith({
      where: { id: "inst-1" },
      data: { gocardlessInstitutionId: null, gocardlessRequisitionId: null },
    });
  });
});

describe("getMigrationHistoryDepth", () => {
  it("returns null/null when the institution doesn't exist", async () => {
    institutionFindUniqueMock.mockResolvedValueOnce(null);
    await expect(getMigrationHistoryDepth("missing")).resolves.toEqual({
      legacyOldest: null,
      woobOldest: null,
    });
  });

  it("returns null/null for an institution that isn't a dedicated-sync one", async () => {
    institutionFindUniqueMock.mockResolvedValueOnce({ name: "Boursorama" });
    await expect(getMigrationHistoryDepth("inst-1")).resolves.toEqual({
      legacyOldest: null,
      woobOldest: null,
    });
    expect(accountFindManyMock).not.toHaveBeenCalled();
  });

  it("matches the 'trade republic' name case-insensitively against the tr: prefix", async () => {
    institutionFindUniqueMock.mockResolvedValueOnce({ name: "Trade Republic" });
    accountFindManyMock.mockResolvedValue([]);
    await getMigrationHistoryDepth("inst-1");
    expect(accountFindManyMock).toHaveBeenCalledWith({
      where: { institutionId: "inst-1", syncId: { startsWith: "tr:" } },
      select: { id: true },
    });
  });

  it("picks the earlier of the oldest Transaction and oldest HistoricalBalance date, per side", async () => {
    institutionFindUniqueMock.mockResolvedValueOnce({ name: "LCL" });
    // First findMany call = legacy (lcl:) accounts, second = woob: accounts.
    accountFindManyMock.mockResolvedValueOnce([{ id: "legacy-1" }]).mockResolvedValueOnce([{ id: "woob-1" }]);

    const legacyTxDate = new Date("2024-01-01");
    const legacyBalanceDate = new Date("2023-06-01"); // earlier than the transaction - must win
    const woobTxDate = new Date("2026-08-01");

    transactionFindFirstMock
      .mockResolvedValueOnce({ date: legacyTxDate })
      .mockResolvedValueOnce({ date: woobTxDate });
    historicalBalanceFindFirstMock
      .mockResolvedValueOnce({ recordedAt: legacyBalanceDate })
      .mockResolvedValueOnce(null);

    const result = await getMigrationHistoryDepth("inst-1");
    expect(result.legacyOldest).toEqual(legacyBalanceDate);
    expect(result.woobOldest).toEqual(woobTxDate);
  });

  it("returns null for a side with no accounts at all, without querying Transaction/HistoricalBalance", async () => {
    institutionFindUniqueMock.mockResolvedValueOnce({ name: "LCL" });
    accountFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await getMigrationHistoryDepth("inst-1");
    expect(result).toEqual({ legacyOldest: null, woobOldest: null });
    expect(transactionFindFirstMock).not.toHaveBeenCalled();
    expect(historicalBalanceFindFirstMock).not.toHaveBeenCalled();
  });
});

describe("migrateDedicatedSyncToWoob", () => {
  it("throws when the institution doesn't exist", async () => {
    institutionFindUniqueMock.mockResolvedValueOnce(null);
    await expect(migrateDedicatedSyncToWoob("missing")).rejects.toThrow("Institution not found");
  });

  it("throws for an institution that isn't a dedicated-sync one", async () => {
    institutionFindUniqueMock.mockResolvedValueOnce({ name: "Boursorama" });
    await expect(migrateDedicatedSyncToWoob("inst-1")).rejects.toThrow("Not a dedicated-sync institution");
  });

  it("refuses to delete anything when no Woob-synced accounts exist yet - the guard against losing the only copy of history", async () => {
    institutionFindUniqueMock.mockResolvedValueOnce({ name: "LCL" });
    accountCountMock.mockResolvedValueOnce(0);
    await expect(migrateDedicatedSyncToWoob("inst-1")).rejects.toThrow(
      "No Woob-synced accounts found yet for this institution - run a Woob sync first",
    );
    expect(accountDeleteManyMock).not.toHaveBeenCalled();
  });

  it("deletes only the lcl:-prefixed accounts and returns the deleted count once Woob data exists", async () => {
    institutionFindUniqueMock.mockResolvedValueOnce({ name: "LCL" });
    accountCountMock.mockResolvedValueOnce(5);
    accountDeleteManyMock.mockResolvedValueOnce({ count: 5 });

    const result = await migrateDedicatedSyncToWoob("inst-1");

    expect(result).toEqual({ deleted: 5 });
    expect(accountDeleteManyMock).toHaveBeenCalledWith({
      where: { institutionId: "inst-1", syncId: { startsWith: "lcl:" } },
    });
  });
});
