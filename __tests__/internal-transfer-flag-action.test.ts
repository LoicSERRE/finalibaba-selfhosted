import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Light coverage only, per this project's stated lib/actions/* boundary (see
// sonar-project.properties' sonar.coverage.exclusions comment) - same shape
// as __tests__/transaction-splits-actions.test.ts: the write shape via a
// mocked Prisma client, not a real database. Added because this is the
// manual override for automatic internal-transfer detection - a bug here
// would either fail to exclude a real transfer from budgets/income, or
// silently exclude a real one.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { txUpdateMock, txUpdateManyMock } = vi.hoisted(() => ({
  txUpdateMock: vi.fn(),
  txUpdateManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    transaction: { update: txUpdateMock, updateMany: txUpdateManyMock },
  },
}));

const { assertTransactionsWritableMock, baseAccountIdsMock } = vi.hoisted(() => ({
  assertTransactionsWritableMock: vi.fn(async () => {}),
  baseAccountIdsMock: vi.fn(async () => ["acc1", "acc2"]),
}));

vi.mock("@/lib/auth-context", () => ({
  getViewer: vi.fn(async () => ({ id: "user-owner", role: "ADMIN", isMonoMode: true })),
  assertTransactionsWritable: assertTransactionsWritableMock,
  assertOwned: vi.fn(async () => {}),
  baseAccountIds: baseAccountIdsMock,
}));

import { setInternalTransferFlag } from "@/lib/actions/transactions";

const SELECT = { accountId: true, categoryId: true, internalTransferPairId: true };

beforeEach(() => {
  txUpdateMock
    .mockReset()
    .mockResolvedValue({ accountId: "acc1", categoryId: "cat1", internalTransferPairId: null });
  txUpdateManyMock.mockReset().mockResolvedValue({ count: 0 });
  assertTransactionsWritableMock.mockReset().mockResolvedValue(undefined);
  baseAccountIdsMock.mockReset().mockResolvedValue(["acc1", "acc2"]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("setInternalTransferFlag", () => {
  it("writes isInternalTransfer: true and never touches categoryId", async () => {
    await setInternalTransferFlag("tx1", true);

    expect(txUpdateMock).toHaveBeenCalledWith({
      where: { id: "tx1" },
      data: { isInternalTransfer: true, internalTransferManual: true },
      select: SELECT,
    });
  });

  it("writes isInternalTransfer: false to unmark it", async () => {
    await setInternalTransferFlag("tx1", false);

    expect(txUpdateMock).toHaveBeenCalledWith({
      where: { id: "tx1" },
      data: { isInternalTransfer: false, internalTransferManual: false },
      select: SELECT,
    });
  });

  it("records the decision as a person's, so the next sync cannot undo it", async () => {
    // The detector's pool is every row with no human decision. Before this
    // column, unmarking a transfer put it straight back in that pool and it
    // was re-flagged within hours - the decision never survived.
    await setInternalTransferFlag("tx1", false);

    expect(txUpdateMock.mock.calls[0][0].data.internalTransferManual).toBe(false);
  });

  it("unmarking one leg releases the other, which is no longer half of anything", async () => {
    txUpdateMock.mockResolvedValue({ accountId: "acc1", categoryId: null, internalTransferPairId: "tx2" });

    await setInternalTransferFlag("tx1", false);

    expect(txUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "tx2", accountId: { in: ["acc1", "acc2"] }, internalTransferManual: null },
      data: { isInternalTransfer: false, internalTransferPairId: null },
    });
  });

  it("marking one leg by hand stops at the row it was asked about", async () => {
    // There is nothing to flag alongside it: the reason to do this by hand is
    // that the counterpart was never recorded anywhere.
    txUpdateMock.mockResolvedValue({ accountId: "acc1", categoryId: null, internalTransferPairId: "tx2" });

    await setInternalTransferFlag("tx1", true);

    expect(txUpdateManyMock).not.toHaveBeenCalled();
  });

  it("checks writability before touching the database", async () => {
    assertTransactionsWritableMock.mockRejectedValueOnce(new Error("Not found."));

    await expect(setInternalTransferFlag("tx1", true)).rejects.toThrow("Not found.");

    expect(txUpdateMock).not.toHaveBeenCalled();
  });
});
