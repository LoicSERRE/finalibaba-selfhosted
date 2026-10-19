import { beforeEach, describe, expect, it, vi } from "vitest";

// setTransactionNote (v2.14) with Prisma mocked: the guard runs first, limits
// come back as keys (never thrown - production would turn a thrown message
// into an opaque digest), and only normalized values are written.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const m = vi.hoisted(() => ({
  update: vi.fn<(args: unknown) => Promise<{ accountId: string; categoryId: string | null }>>(async () => ({ accountId: "acc-1", categoryId: null })),
  assertTransactionsWritable: vi.fn(async () => {}),
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: { transaction: { update: m.update } } }));
vi.mock("@/lib/auth-context", () => ({
  getViewer: vi.fn(async () => ({ id: "user-a" })),
  assertTransactionsWritable: m.assertTransactionsWritable,
  assertOwned: vi.fn(),
  baseAccountIds: vi.fn(),
}));
vi.mock("@/lib/actions/auto-categorize", () => ({ autoCategorizeTransactions: vi.fn() }));
vi.mock("@/lib/actions/manual-account-guard", () => ({ assertManualAccountEligible: vi.fn() }));
vi.mock("@/lib/services/undo-store", () => ({ rememberUndo: vi.fn() }));

import { setTransactionNote } from "@/lib/actions/transactions";

beforeEach(() => vi.clearAllMocks());

describe("setTransactionNote", () => {
  it("authorizes the transaction before anything else", async () => {
    m.assertTransactionsWritable.mockRejectedValueOnce(new Error("Not found."));
    await expect(setTransactionNote("someone-elses", "x", [])).rejects.toThrow("Not found.");
    expect(m.update).not.toHaveBeenCalled();
  });

  it("writes the normalized note and tags", async () => {
    const result = await setTransactionNote("t1", "  remboursé  ", ["#Vacances", "vacances", " pro "]);
    expect(m.assertTransactionsWritable).toHaveBeenCalledWith("user-a", ["t1"]);
    expect(m.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { note: "remboursé", tags: ["Vacances", "pro"] },
      select: { accountId: true, categoryId: true },
    });
    expect(result).toEqual({ ok: true, data: { note: "remboursé", tags: ["Vacances", "pro"] } });
  });

  it("clears both with empty input", async () => {
    await setTransactionNote("t1", "   ", []);
    expect(m.update.mock.calls[0][0]).toMatchObject({ data: { note: null, tags: [] } });
  });

  it("returns a limit as a key and writes nothing", async () => {
    expect(await setTransactionNote("t1", "x".repeat(501), [])).toEqual({ ok: false, error: "note_too_long" });
    expect(await setTransactionNote("t1", "", Array.from({ length: 11 }, (_, i) => `t${i}`))).toEqual({ ok: false, error: "too_many_tags" });
    expect(m.update).not.toHaveBeenCalled();
  });

  it("ignores anything in the tag list that is not a string", async () => {
    await setTransactionNote("t1", "", ["ok", 42, null] as unknown as string[]);
    expect(m.update.mock.calls[0][0]).toMatchObject({ data: { tags: ["ok"] } });
  });
});
