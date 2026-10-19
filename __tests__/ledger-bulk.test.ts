import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The ledger's bulk edits (v2.14) and their undo, with Prisma mocked - the
 * write shapes and the guards, not a database (the browser run against a
 * real one is in the PR). What these pin is what a refactor would quietly
 * lose: a forged id fails the whole batch, a split is never flattened, an
 * unchanged row is not "changed", and undo only touches rows still in the
 * state the bulk edit left them in, on accounts still writable.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const m = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(async (args: unknown) => ({ count: 0, args })),
  transaction: vi.fn(async (ops: unknown[]) => ops),
  assertTransactionsWritable: vi.fn(async () => {}),
  assertOwned: vi.fn(async () => {}),
  rememberUndo: vi.fn(() => "tok"),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: { transaction: { findMany: m.findMany, updateMany: m.updateMany }, $transaction: m.transaction },
}));
vi.mock("@/lib/auth-context", () => ({
  getViewer: vi.fn(async () => ({ id: "user-a" })),
  assertTransactionsWritable: m.assertTransactionsWritable,
  assertOwned: m.assertOwned,
  baseAccountIds: vi.fn(async () => ["acc-1"]),
}));
vi.mock("@/lib/services/undo-store", () => ({ rememberUndo: m.rememberUndo }));
vi.mock("@/lib/actions/auto-categorize", () => ({ autoCategorizeTransactions: vi.fn() }));
vi.mock("@/lib/actions/manual-account-guard", () => ({ assertManualAccountEligible: vi.fn() }));

import { BULK_EDIT_MAX, parseBulkIds } from "@/lib/domain/transactions-ledger";
import { bulkCategorizeTransactions, bulkMarkInternalTransfers } from "@/lib/actions/transactions";
import { restoreTransactionsCategory, restoreTransactionsTransfer } from "@/lib/services/undo-deletion";

beforeEach(() => vi.clearAllMocks());

const row = (id: string, categoryId: string | null, split = false) => ({
  id, categoryId, accountId: "acc-1", splits: split ? [{ id: `s-${id}` }] : [],
});

describe("parseBulkIds", () => {
  it("accepts a list of ids, deduplicated", () => {
    expect(parseBulkIds(["a", "b", "a"])).toEqual(["a", "b"]);
  });

  it("rejects anything else a caller could send", () => {
    for (const bad of [[], "a", null, [1], [""], ["x".repeat(65)], Array(BULK_EDIT_MAX + 1).fill("a")]) {
      expect(parseBulkIds(bad)).toBeNull();
    }
  });
});

describe("bulkCategorizeTransactions", () => {
  it("refuses a malformed selection before touching anything", async () => {
    expect(await bulkCategorizeTransactions([] as string[], "c1")).toEqual({ ok: false, error: "invalid_selection" });
    expect(m.assertTransactionsWritable).not.toHaveBeenCalled();
  });

  it("checks every id and the category before writing", async () => {
    m.assertTransactionsWritable.mockRejectedValueOnce(new Error("Not found."));
    await expect(bulkCategorizeTransactions(["t1", "forged"], "c1")).rejects.toThrow("Not found.");
    expect(m.assertTransactionsWritable).toHaveBeenCalledWith("user-a", ["t1", "forged"]);
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("leaves split and already-matching rows alone, and snapshots what it changed", async () => {
    m.findMany.mockResolvedValueOnce([row("t1", null), row("t2", "old"), row("t3", "x", true), row("t4", "c1")]);
    const result = await bulkCategorizeTransactions(["t1", "t2", "t3", "t4"], "c1");
    expect(m.assertOwned).toHaveBeenCalledWith("category", "c1", "user-a");
    expect(m.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["t1", "t2"] }, splits: { none: {} } }, data: { categoryId: "c1" } });
    expect(m.rememberUndo).toHaveBeenCalledWith("user-a", {
      kind: "transactionsCategory",
      assignedCategoryId: "c1",
      previous: [{ id: "t1", categoryId: null }, { id: "t2", categoryId: "old" }],
      accountIds: ["acc-1"],
    });
    expect(result).toEqual({ ok: true, data: { updated: 2, skippedSplit: 1, undoToken: "tok" } });
  });

  it("reports nothing to undo when nothing changed", async () => {
    m.findMany.mockResolvedValueOnce([row("t1", "c1"), row("t2", null, true)]);
    expect(await bulkCategorizeTransactions(["t1", "t2"], "c1")).toEqual({ ok: true, data: { updated: 0, skippedSplit: 1, undoToken: null } });
    expect(m.updateMany).not.toHaveBeenCalled();
  });
});

describe("bulkMarkInternalTransfers", () => {
  it("marks by hand only rows not already transfers, and remembers each prior manual flag", async () => {
    m.findMany.mockResolvedValueOnce([
      { id: "t1", accountId: "acc-1", categoryId: null, internalTransferManual: null },
      { id: "t2", accountId: "acc-1", categoryId: "c1", internalTransferManual: false },
    ]);
    const result = await bulkMarkInternalTransfers(["t1", "t2"]);
    expect(m.findMany.mock.calls[0][0]).toMatchObject({ where: { id: { in: ["t1", "t2"] }, isInternalTransfer: false } });
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["t1", "t2"] }, isInternalTransfer: false },
      data: { isInternalTransfer: true, internalTransferManual: true },
    });
    expect(m.rememberUndo).toHaveBeenCalledWith("user-a", {
      kind: "transactionsTransfer",
      previous: [{ id: "t1", internalTransferManual: null }, { id: "t2", internalTransferManual: false }],
      accountIds: ["acc-1"],
    });
    expect(result).toEqual({ ok: true, data: { updated: 2, undoToken: "tok" } });
  });
});

describe("undoing a bulk edit", () => {
  it("puts categories back only where the bulk edit is still what is there", async () => {
    await restoreTransactionsCategory(
      { kind: "transactionsCategory", assignedCategoryId: "c1", previous: [{ id: "t1", categoryId: null }, { id: "t2", categoryId: "old" }, { id: "t3", categoryId: null }], accountIds: ["acc-1"] },
      ["acc-1"]
    );
    expect(m.updateMany.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: { in: ["t1", "t3"] }, accountId: { in: ["acc-1"] }, categoryId: "c1", splits: { none: {} } }, data: { categoryId: null } },
      { where: { id: { in: ["t2"] }, accountId: { in: ["acc-1"] }, categoryId: "c1", splits: { none: {} } }, data: { categoryId: "old" } },
    ]);
  });

  it("un-marks only rows still marked by hand, back to their prior flag", async () => {
    await restoreTransactionsTransfer(
      { kind: "transactionsTransfer", previous: [{ id: "t1", internalTransferManual: null }, { id: "t2", internalTransferManual: false }], accountIds: ["acc-1"] },
      ["acc-1"]
    );
    expect(m.updateMany.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: { in: ["t1"] }, accountId: { in: ["acc-1"] }, isInternalTransfer: true, internalTransferManual: true }, data: { isInternalTransfer: false, internalTransferManual: null } },
      { where: { id: { in: ["t2"] }, accountId: { in: ["acc-1"] }, isInternalTransfer: true, internalTransferManual: true }, data: { isInternalTransfer: false, internalTransferManual: false } },
    ]);
  });
});
