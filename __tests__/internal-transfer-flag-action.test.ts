import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Light coverage only, per this project's stated lib/actions/* boundary (see
// sonar-project.properties' sonar.coverage.exclusions comment) - same shape
// as __tests__/transaction-splits-actions.test.ts: the write shape via a
// mocked Prisma client, not a real database. Added because this is the
// manual override for automatic internal-transfer detection - a bug here
// would either fail to exclude a real transfer from budgets/income, or
// silently exclude a real one.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { txUpdateMock } = vi.hoisted(() => ({
  txUpdateMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    transaction: { update: txUpdateMock },
  },
}));

const { assertTransactionsWritableMock } = vi.hoisted(() => ({
  assertTransactionsWritableMock: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth-context", () => ({
  getViewer: vi.fn(async () => ({ id: "user-owner", role: "ADMIN", isMonoMode: true })),
  assertTransactionsWritable: assertTransactionsWritableMock,
}));

import { setInternalTransferFlag } from "@/lib/actions/transactions";

beforeEach(() => {
  txUpdateMock.mockReset().mockResolvedValue({ accountId: "acc1", categoryId: "cat1" });
  assertTransactionsWritableMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("setInternalTransferFlag", () => {
  it("writes isInternalTransfer: true and never touches categoryId", async () => {
    await setInternalTransferFlag("tx1", true);

    expect(txUpdateMock).toHaveBeenCalledWith({
      where: { id: "tx1" },
      data: { isInternalTransfer: true },
      select: { accountId: true, categoryId: true },
    });
  });

  it("writes isInternalTransfer: false to unmark it", async () => {
    await setInternalTransferFlag("tx1", false);

    expect(txUpdateMock).toHaveBeenCalledWith({
      where: { id: "tx1" },
      data: { isInternalTransfer: false },
      select: { accountId: true, categoryId: true },
    });
  });

  it("checks writability before touching the database", async () => {
    assertTransactionsWritableMock.mockRejectedValueOnce(new Error("Not found."));

    await expect(setInternalTransferFlag("tx1", true)).rejects.toThrow("Not found.");

    expect(txUpdateMock).not.toHaveBeenCalled();
  });
});
