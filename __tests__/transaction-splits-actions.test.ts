import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Light coverage only, per this project's stated lib/actions/* boundary
// (see sonar-project.properties' sonar.coverage.exclusions comment) - same
// shape as __tests__/totp-actions.test.ts: error paths and the DB-write
// payload shape via a mocked Prisma client, not a real database. Added
// specifically because setTransactionSplits is the one write path that
// enforces the split-sum invariant and the "categoryId null iff split"
// invariant everything else in "Split transactions" (CLAUDE.md) relies on -
// a real bug here would silently corrupt category totals across the app.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const {
  txFindUniqueOrThrowMock,
  txUpdateMock,
  splitFindManyMock,
  splitDeleteManyMock,
  splitCreateManyMock,
  transactionMock,
} = vi.hoisted(() => ({
  txFindUniqueOrThrowMock: vi.fn(),
  txUpdateMock: vi.fn(),
  splitFindManyMock: vi.fn(),
  splitDeleteManyMock: vi.fn(),
  splitCreateManyMock: vi.fn(),
  transactionMock: vi.fn((ops: unknown[]) => Promise.all(ops)),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    transaction: { findUniqueOrThrow: txFindUniqueOrThrowMock, update: txUpdateMock },
    transactionSplit: { findMany: splitFindManyMock, deleteMany: splitDeleteManyMock, createMany: splitCreateManyMock },
    $transaction: transactionMock,
  },
}));

import { setTransactionSplits, clearTransactionSplits } from "@/lib/actions/transaction-splits";

beforeEach(() => {
  txFindUniqueOrThrowMock.mockReset();
  txUpdateMock.mockReset().mockResolvedValue({});
  splitFindManyMock.mockReset().mockResolvedValue([]);
  splitDeleteManyMock.mockReset().mockResolvedValue({});
  splitCreateManyMock.mockReset().mockResolvedValue({});
  transactionMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("setTransactionSplits", () => {
  it("throws and never writes anything when the lines don't sum to the transaction total", async () => {
    txFindUniqueOrThrowMock.mockResolvedValueOnce({ accountId: "acc1", amountCents: BigInt(-14900), categoryId: "cat-old" });

    await expect(
      setTransactionSplits("tx1", [
        { categoryId: "cat1", amountEuro: "100" },
        { categoryId: "cat2", amountEuro: "40" },
      ]),
    ).rejects.toThrow("Invalid split: does_not_sum_to_total");

    expect(transactionMock).not.toHaveBeenCalled();
    expect(splitDeleteManyMock).not.toHaveBeenCalled();
  });

  it("throws on a single line even if it matches the total (a split needs 2+ categories)", async () => {
    txFindUniqueOrThrowMock.mockResolvedValueOnce({ accountId: "acc1", amountCents: BigInt(-14900), categoryId: null });

    await expect(setTransactionSplits("tx1", [{ categoryId: "cat1", amountEuro: "149" }])).rejects.toThrow(
      "Invalid split: too_few_lines",
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("infers a negative sign per line for a debit transaction from a plain positive euro magnitude", async () => {
    txFindUniqueOrThrowMock.mockResolvedValueOnce({ accountId: "acc1", amountCents: BigInt(-14900), categoryId: null });

    await setTransactionSplits("tx1", [
      { categoryId: "cat1", amountEuro: "100" },
      { categoryId: "cat2", amountEuro: "49" },
    ]);

    expect(splitCreateManyMock).toHaveBeenCalledWith({
      data: [
        { transactionId: "tx1", categoryId: "cat1", amountCents: BigInt(-10000) },
        { transactionId: "tx1", categoryId: "cat2", amountCents: BigInt(-4900) },
      ],
    });
  });

  it("infers a positive sign per line for a credit transaction", async () => {
    txFindUniqueOrThrowMock.mockResolvedValueOnce({ accountId: "acc1", amountCents: BigInt(20000), categoryId: null });

    await setTransactionSplits("tx1", [
      { categoryId: "cat1", amountEuro: "150" },
      { categoryId: "cat2", amountEuro: "50" },
    ]);

    expect(splitCreateManyMock).toHaveBeenCalledWith({
      data: [
        { transactionId: "tx1", categoryId: "cat1", amountCents: BigInt(15000) },
        { transactionId: "tx1", categoryId: "cat2", amountCents: BigInt(5000) },
      ],
    });
  });

  it("deletes any existing splits and nulls the parent categoryId in the same $transaction", async () => {
    txFindUniqueOrThrowMock.mockResolvedValueOnce({ accountId: "acc1", amountCents: BigInt(-5000), categoryId: null });
    splitFindManyMock.mockResolvedValueOnce([{ categoryId: "cat-stale" }]);

    await setTransactionSplits("tx1", [
      { categoryId: "cat1", amountEuro: "30" },
      { categoryId: "cat2", amountEuro: "20" },
    ]);

    expect(splitDeleteManyMock).toHaveBeenCalledWith({ where: { transactionId: "tx1" } });
    expect(txUpdateMock).toHaveBeenCalledWith({ where: { id: "tx1" }, data: { categoryId: null } });
    expect(transactionMock).toHaveBeenCalledTimes(1);
  });

  it("allows a null categoryId on one line (a deliberately uncategorized portion)", async () => {
    txFindUniqueOrThrowMock.mockResolvedValueOnce({ accountId: "acc1", amountCents: BigInt(-5000), categoryId: null });

    await setTransactionSplits("tx1", [
      { categoryId: "cat1", amountEuro: "30" },
      { categoryId: null, amountEuro: "20" },
    ]);

    expect(splitCreateManyMock).toHaveBeenCalledWith({
      data: [
        { transactionId: "tx1", categoryId: "cat1", amountCents: BigInt(-3000) },
        { transactionId: "tx1", categoryId: null, amountCents: BigInt(-2000) },
      ],
    });
  });
});

describe("clearTransactionSplits", () => {
  it("is a no-op when the transaction has no existing splits", async () => {
    splitFindManyMock.mockResolvedValueOnce([]);

    await clearTransactionSplits("tx1");

    expect(txFindUniqueOrThrowMock).not.toHaveBeenCalled();
    expect(splitDeleteManyMock).not.toHaveBeenCalled();
  });

  it("deletes every split row when they exist", async () => {
    splitFindManyMock.mockResolvedValueOnce([{ categoryId: "cat1" }, { categoryId: "cat2" }]);
    txFindUniqueOrThrowMock.mockResolvedValueOnce({ accountId: "acc1" });

    await clearTransactionSplits("tx1");

    expect(splitDeleteManyMock).toHaveBeenCalledWith({ where: { transactionId: "tx1" } });
  });
});
