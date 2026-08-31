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
  institutionFindFirstMock,
  accountCountMock,
  accountFindManyMock,
  accountFindUniqueMock,
  accountUpdateMock,
  accountDeleteManyMock,
  transactionFindFirstMock,
  historicalBalanceFindFirstMock,
} = vi.hoisted(() => ({
  institutionCreateMock: vi.fn(),
  institutionUpdateMock: vi.fn(),
  institutionDeleteMock: vi.fn(),
  institutionFindUniqueMock: vi.fn(),
  institutionFindFirstMock: vi.fn(),
  accountCountMock: vi.fn(),
  accountFindManyMock: vi.fn(),
  accountFindUniqueMock: vi.fn(),
  accountUpdateMock: vi.fn(),
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
      findFirst: institutionFindFirstMock,
    },
    account: {
      count: accountCountMock,
      findMany: accountFindManyMock,
      findUnique: accountFindUniqueMock,
      update: accountUpdateMock,
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
  adoptDedicatedTrAccounts,
  setWoobConfig,
  setTradeRepublicConfig,
  clearTradeRepublicConfig,
} from "@/lib/actions/institutions";

beforeEach(() => {
  institutionCreateMock.mockReset().mockResolvedValue({});
  institutionUpdateMock.mockReset().mockResolvedValue({});
  institutionDeleteMock.mockReset().mockResolvedValue({});
  institutionFindUniqueMock.mockReset();
  // No same-named institution unless a test says otherwise - the common case.
  institutionFindFirstMock.mockReset().mockResolvedValue(null);
  accountCountMock.mockReset();
  accountFindManyMock.mockReset().mockResolvedValue([]);
  accountFindUniqueMock.mockReset().mockResolvedValue(null);
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

  it("matches Trade Republic's legacy accounts by exact id, never by the tr: prefix", async () => {
    // `startsWith: "tr:"` also matches the per-user tr:<institutionId>: shape,
    // so this query feeding a deleteMany would take the accounts the migration
    // just created. Exact ids are the only safe way to name the env sync's own.
    institutionFindUniqueMock.mockResolvedValueOnce({ name: "Trade Republic" });
    accountFindManyMock.mockResolvedValue([]);

    await getMigrationHistoryDepth("inst-1");

    expect(accountFindManyMock).toHaveBeenCalledWith({
      where: { institutionId: "inst-1", syncId: { in: ["tr:cash", "tr:cto", "tr:pea", "tr:crypto"] } },
      select: { id: true },
    });
  });

  it("counts either backend as the destination, so a move to per-user Trade Republic qualifies", async () => {
    // Only `woob:` used to count, so someone moving off TR_PHONE onto their
    // own Trade Republic credentials could never satisfy the guard and the
    // migration refused forever.
    institutionFindUniqueMock.mockResolvedValueOnce({ name: "Trade Republic" });
    accountFindManyMock.mockResolvedValue([]);

    await getMigrationHistoryDepth("inst-1");

    expect(accountFindManyMock).toHaveBeenCalledWith({
      where: {
        institutionId: "inst-1",
        OR: [
          { syncId: { startsWith: "woob:inst-1:" } },
          { syncId: { startsWith: "tr:inst-1:" } },
        ],
      },
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
      "No accounts from the new sync found yet for this institution - run it once first",
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

// An institution carries exactly one sync provider (v2.1 added Trade Republic
// alongside Woob). The sync service dispatches on which credential set is
// populated, so an institution left holding both would run whichever backend
// its `if` chain tests first - a silent, order-dependent choice the user never
// made. These assert the write shape actually clears the other side rather
// than only setting its own fields.
describe("provider config is mutually exclusive", () => {
  it("setWoobConfig clears any Trade Republic credentials", async () => {
    await setWoobConfig("inst-1", "lcl", "user", "secret");

    expect(institutionUpdateMock).toHaveBeenCalledWith({
      where: { id: "inst-1" },
      data: {
        woobModule: "lcl",
        woobLogin: "user",
        woobPassword: "secret",
        trPhone: null,
        trPin: null,
      },
    });
  });

  it("setTradeRepublicConfig clears any Woob credentials", async () => {
    await setTradeRepublicConfig("inst-1", "+33612345678", "1234");

    expect(institutionUpdateMock).toHaveBeenCalledWith({
      where: { id: "inst-1" },
      data: {
        trPhone: "+33612345678",
        trPin: "1234",
        woobModule: null,
        woobLogin: null,
        woobPassword: null,
      },
    });
  });
});

describe("setTradeRepublicConfig", () => {
  it.each([
    ["", "1234", "no phone"],
    ["+33612345678", "", "no PIN"],
    ["   ", "1234", "whitespace-only phone"],
    ["+33612345678", "   ", "whitespace-only PIN"],
  ])("rejects %s / %s (%s)", async (phone, pin, why) => {
    // Writing a half-configured institution would make it look connected in
    // Settings while every sync fails with a Python-side credential error.
    await expect(setTradeRepublicConfig("inst-1", phone, pin), why).rejects.toThrow(
      "Numéro de téléphone et code PIN requis.",
    );
    expect(institutionUpdateMock).not.toHaveBeenCalled();
  });

  it("trims what it stores", async () => {
    await setTradeRepublicConfig("inst-1", "  +33612345678 ", " 1234 ");

    expect(institutionUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ trPhone: "+33612345678", trPin: "1234" }) }),
    );
  });
});

describe("clearTradeRepublicConfig", () => {
  it("only nulls the credentials, never touches accounts", async () => {
    // Disconnecting a sync must never destroy the history it already
    // imported - same contract as clearWoobConfig.
    await clearTradeRepublicConfig("inst-1");

    expect(institutionUpdateMock).toHaveBeenCalledWith({
      where: { id: "inst-1" },
      data: { trPhone: null, trPin: null },
    });
    expect(accountDeleteManyMock).not.toHaveBeenCalled();
    expect(institutionDeleteMock).not.toHaveBeenCalled();
  });
});

// prisma/seed.ts ships credential-less reference rows for the common banks
// ("Trade Republic", "LCL", "Coinbase"), and Institution names are unique per
// user - so on a seeded install, which is the documented default, picking one
// of those from the bank list is a name collision. Before v2.1 that only
// happened to whoever picked a seeded Woob bank; making Trade Republic a
// picker entry put the headline feature straight onto that path.
describe("createInstitution against an existing name", () => {
  it("attaches credentials to a credential-less row instead of failing on the unique name", async () => {
    institutionFindFirstMock.mockResolvedValueOnce({
      id: "inst-seeded",
      woobModule: null,
      trPhone: null,
    });

    await createInstitution(
      formData({ name: "Trade Republic", trPhone: "+33612345678", trPin: "1234" }),
    );

    expect(institutionCreateMock).not.toHaveBeenCalled();
    expect(institutionUpdateMock).toHaveBeenCalledWith({
      where: { id: "inst-seeded" },
      data: { trPhone: "+33612345678", trPin: "1234" },
    });
  });

  it.each([
    [{ woobModule: "lcl", trPhone: null }, "already syncs through Woob"],
    [{ woobModule: null, trPhone: "+33612345678" }, "already syncs through Trade Republic"],
  ])("refuses to repoint one that %s (%s)", async (state, why) => {
    // Silently rewriting a working connection under the same name is the one
    // outcome nobody could have meant by "add a bank".
    institutionFindFirstMock.mockResolvedValueOnce({ id: "inst-1", ...state });

    await expect(
      createInstitution(formData({ name: "LCL", woobModule: "lcl", woobLogin: "u", woobPassword: "p" })),
      why,
    ).rejects.toThrow("est déjà configurée");
    expect(institutionUpdateMock).not.toHaveBeenCalled();
    expect(institutionCreateMock).not.toHaveBeenCalled();
  });
});

describe("createInstitution provider selection", () => {
  it("writes Trade Republic credentials when the picked bank is Trade Republic", async () => {
    await createInstitution(
      formData({ name: "Trade Republic", trPhone: "+33612345678", trPin: "1234" }),
    );
    expect(institutionCreateMock).toHaveBeenCalledWith({
      data: { userId: "user-owner", name: "Trade Republic", trPhone: "+33612345678", trPin: "1234" },
    });
  });

  it("never writes both providers onto one row", async () => {
    // The picker only ever offers one, but this is a Server Action and the
    // form payload is whatever the caller sends. An institution holding both
    // would run whichever backend the sync service tests first.
    await createInstitution(
      formData({
        name: "Confused",
        trPhone: "+33612345678",
        trPin: "1234",
        woobModule: "lcl",
        woobLogin: "u",
        woobPassword: "p",
      }),
    );
    const { data } = institutionCreateMock.mock.calls[0][0];
    expect(data).toEqual({
      userId: "user-owner",
      name: "Confused",
      trPhone: "+33612345678",
      trPin: "1234",
    });
  });

  it("ignores a half-filled Trade Republic payload rather than storing it", async () => {
    await createInstitution(formData({ name: "Half", trPhone: "+33612345678" }));
    expect(institutionCreateMock).toHaveBeenCalledWith({
      data: { userId: "user-owner", name: "Half" },
    });
  });
});

// Moving off TR_PHONE onto per-user credentials must not cost anyone their
// history. migrateDedicatedSyncToWoob DELETES the legacy accounts, which for
// Trade Republic would throw away years of transactions to restart from
// whatever the API still serves - the shape that already cost a real user
// their LCL history in v1.11. Nothing needs deleting: only the string saying
// which sync owns the row is wrong.
describe("adoptDedicatedTrAccounts", () => {
  const INSTITUTION = { trPhone: "+33612345678" };

  beforeEach(() => {
    delete process.env.TR_PHONE;
    institutionFindUniqueMock.mockResolvedValue(INSTITUTION);
    accountUpdateMock.mockResolvedValue({});
  });

  afterEach(() => {
    delete process.env.TR_PHONE;
  });

  it("refuses while TR_PHONE is still set", async () => {
    // Not caution: the env sync resolves its accounts by those same legacy
    // ids, so running between the rename and the .env edit would recreate
    // them - the duplicate set this operation exists to avoid.
    process.env.TR_PHONE = "+33612345678";

    await expect(adoptDedicatedTrAccounts("inst-1")).rejects.toThrow("TR_PHONE");
    expect(accountUpdateMock).not.toHaveBeenCalled();
  });

  it("refuses when the institution has no Trade Republic credentials yet", async () => {
    institutionFindUniqueMock.mockResolvedValue({ trPhone: null });

    await expect(adoptDedicatedTrAccounts("inst-1")).rejects.toThrow("Configure d'abord");
    expect(accountUpdateMock).not.toHaveBeenCalled();
  });

  it("renames each legacy account in place, never deleting one", async () => {
    accountFindManyMock.mockResolvedValueOnce([
      { id: "a1", syncId: "tr:cash" },
      { id: "a2", syncId: "tr:cto" },
    ]);

    await expect(adoptDedicatedTrAccounts("inst-1")).resolves.toEqual({ adopted: 2 });

    expect(accountUpdateMock).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { syncId: "tr:inst-1:cash" },
    });
    expect(accountUpdateMock).toHaveBeenCalledWith({
      where: { id: "a2" },
      data: { syncId: "tr:inst-1:cto" },
    });
    // The whole point: the rows survive, so their transactions, balances and
    // holdings do too.
    expect(accountDeleteManyMock).not.toHaveBeenCalled();
  });

  it("only ever reads the four exact legacy ids, never a tr: prefix", async () => {
    await adoptDedicatedTrAccounts("inst-1");

    expect(accountFindManyMock).toHaveBeenCalledWith({
      where: { institutionId: "inst-1", syncId: { in: ["tr:cash", "tr:cto", "tr:pea", "tr:crypto"] } },
      select: { id: true, syncId: true },
    });
  });

  it("skips an account whose per-user id already exists rather than colliding", async () => {
    // syncId is globally unique, so renaming onto a taken id would throw. A
    // per-user sync has already made its own copy; merging two accounts on a
    // guess is not this action's call.
    accountFindManyMock.mockResolvedValueOnce([{ id: "a1", syncId: "tr:cash" }]);
    accountFindUniqueMock.mockResolvedValueOnce({ id: "already-there" });

    await expect(adoptDedicatedTrAccounts("inst-1")).resolves.toEqual({ adopted: 0 });
    expect(accountUpdateMock).not.toHaveBeenCalled();
  });
});
