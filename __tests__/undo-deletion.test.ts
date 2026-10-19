import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The restore half of undo (v2.13), with Prisma mocked: the write shapes, not
 * a database (that half was verified end to end in a browser against a real
 * one). The property worth pinning is the one a tidy refactor would drop:
 * re-linking is scoped to rows that are STILL unassigned, so a transaction
 * the user recategorized while the toast was up keeps their newer choice.
 */

const { calls, record } = vi.hoisted(() => {
  const calls: Array<{ op: string; args: unknown }> = [];
  const record = (op: string) => vi.fn((args: unknown) => { calls.push({ op, args }); return { op }; });
  return { calls, record };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (ops: unknown[]) => ops),
    category: { create: record("category.create"), findUniqueOrThrow: vi.fn(async () => ({ id: "c1", name: "Rent" })) },
    transaction: { updateMany: record("transaction.updateMany"), findMany: vi.fn(async () => [{ id: "t1" }, { id: "t2" }]) },
    transactionSplit: { updateMany: record("split.updateMany"), findMany: vi.fn(async () => [{ id: "s1" }]) },
    recurringTransaction: { updateMany: record("recurring.updateMany"), update: record("recurring.update"), findMany: vi.fn(async () => [{ id: "r1" }]) },
    alertRule: { createMany: record("alertRule.createMany"), findMany: vi.fn(async () => [{ id: "a1", categoryId: "c1" }]) },
    goal: { create: record("goal.create") },
    incomeEvent: { create: record("incomeEvent.create") },
  },
}));

import { restoreCategory, restoreRecurring, snapshotCategory } from "@/lib/services/undo-deletion";

beforeEach(() => { calls.length = 0; });

describe("a category", () => {
  it("is snapshotted with everything its deletion changes", async () => {
    expect(await snapshotCategory("c1")).toEqual({
      kind: "category",
      category: { id: "c1", name: "Rent" },
      transactionIds: ["t1", "t2"],
      splitIds: ["s1"],
      recurringIds: ["r1"],
      alertRules: [{ id: "a1", categoryId: "c1" }],
    });
  });

  it("comes back with its own id, re-linking only rows still unassigned", async () => {
    const snapshot = await snapshotCategory("c1");
    await restoreCategory(snapshot as Extract<typeof snapshot, { kind: "category" }>);
    expect(calls.map((c) => c.op)).toEqual([
      "category.create", "transaction.updateMany", "split.updateMany", "recurring.updateMany", "alertRule.createMany",
    ]);
    expect(calls[0].args).toEqual({ data: { id: "c1", name: "Rent" } });
    for (const call of calls.slice(1, 4)) {
      expect(call.args).toMatchObject({ where: { categoryId: null }, data: { categoryId: "c1" } });
    }
    expect(calls[1].args).toMatchObject({ where: { id: { in: ["t1", "t2"] } } });
    expect(calls[4].args).toEqual({ data: [{ id: "a1", categoryId: "c1" }] });
  });
});

describe("a recurring series", () => {
  it("returns to its exact prior state, paused included", async () => {
    await restoreRecurring({ kind: "recurring", id: "r1", accountId: "acc", active: false, dismissedAt: null });
    expect(calls).toEqual([{ op: "recurring.update", args: { where: { id: "r1" }, data: { active: false, dismissedAt: null } } }]);
  });
});
