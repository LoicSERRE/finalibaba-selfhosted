import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Undo for deletions (v2.13): the token store, and the action that spends a
 * token. The restores themselves write through Prisma and are exercised
 * end-to-end against a real database (see the PR); what is pinned here is
 * the part a test can hold without one - who may spend a token, how often,
 * for how long, and that account-scoped rows are re-authorized before
 * anything is written.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

const mocks = vi.hoisted(() => ({
  viewerId: "user-a",
  assertAccountWritable: vi.fn(async () => {}),
  restoreCategory: vi.fn(async () => {}),
  restoreGoal: vi.fn(async () => {}),
  restoreIncomeEvent: vi.fn(async () => {}),
  restoreRecurring: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth-context", () => ({
  getViewer: vi.fn(async () => ({ id: mocks.viewerId })),
  assertAccountWritable: mocks.assertAccountWritable,
}));

vi.mock("@/lib/services/undo-deletion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/undo-deletion")>()),
  restoreCategory: mocks.restoreCategory,
  restoreGoal: mocks.restoreGoal,
  restoreIncomeEvent: mocks.restoreIncomeEvent,
  restoreRecurring: mocks.restoreRecurring,
}));

import { clearUndoStore, rememberUndo, takeUndo, UNDO_WINDOW_MS } from "@/lib/services/undo-store";
import { isRestoreConflict } from "@/lib/services/undo-deletion";
import { undoDeletion } from "@/lib/actions/undo";

beforeEach(() => {
  clearUndoStore();
  mocks.viewerId = "user-a";
  vi.clearAllMocks();
});
afterEach(() => clearUndoStore());

describe("the token store", () => {
  it("gives a snapshot back once, to the user it was issued to", () => {
    const token = rememberUndo("user-a", { n: 1 });
    expect(takeUndo("user-a", token)).toEqual({ n: 1 });
    expect(takeUndo("user-a", token)).toBeNull();
  });

  it("answers another user exactly like an unknown token, and stays usable by its owner", () => {
    const token = rememberUndo("user-a", { n: 1 });
    expect(takeUndo("user-b", token)).toBeNull();
    expect(takeUndo("user-b", "not-a-token")).toBeNull();
    expect(takeUndo("user-a", token)).toEqual({ n: 1 });
  });

  it("expires after the window", () => {
    const now = 1_000_000;
    const token = rememberUndo("user-a", { n: 1 }, now);
    expect(takeUndo("user-a", token, now + UNDO_WINDOW_MS)).toBeNull();
    const fresh = rememberUndo("user-a", { n: 2 }, now);
    expect(takeUndo("user-a", fresh, now + UNDO_WINDOW_MS - 1)).toEqual({ n: 2 });
  });

  it("issues unguessable, distinct tokens", () => {
    const a = rememberUndo("user-a", 1);
    const b = rememberUndo("user-a", 2);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("undoDeletion", () => {
  const goal = { kind: "goal" as const, goal: { id: "g1" } };
  const income = { kind: "incomeEvent" as const, event: { id: "e1", accountId: "acc-1" } };
  const recurring = { kind: "recurring" as const, id: "r1", accountId: "acc-2", active: false, dismissedAt: null };

  it("restores what the token names", async () => {
    const token = rememberUndo("user-a", goal);
    expect(await undoDeletion(token)).toEqual({ ok: true, data: undefined });
    expect(mocks.restoreGoal).toHaveBeenCalledWith(goal);
  });

  it("reports an unknown, spent or foreign token as expired, and restores nothing", async () => {
    expect(await undoDeletion("nope")).toEqual({ ok: false, error: "undo_expired" });
    const token = rememberUndo("user-b", goal);
    expect(await undoDeletion(token)).toEqual({ ok: false, error: "undo_expired" });
    expect(await undoDeletion(123 as unknown as string)).toEqual({ ok: false, error: "undo_expired" });
    expect(mocks.restoreGoal).not.toHaveBeenCalled();
  });

  it("re-authorizes an account-scoped row before writing it back", async () => {
    await undoDeletion(rememberUndo("user-a", income));
    expect(mocks.assertAccountWritable).toHaveBeenCalledWith("user-a", "acc-1");
    await undoDeletion(rememberUndo("user-a", recurring));
    expect(mocks.assertAccountWritable).toHaveBeenCalledWith("user-a", "acc-2");
    expect(mocks.restoreRecurring).toHaveBeenCalledWith(recurring);
  });

  it("writes nothing when access was revoked inside the window", async () => {
    mocks.assertAccountWritable.mockRejectedValueOnce(new Error("Not found."));
    await expect(undoDeletion(rememberUndo("user-a", income))).rejects.toThrow("Not found.");
    expect(mocks.restoreIncomeEvent).not.toHaveBeenCalled();
  });

  it("turns a unique or foreign-key clash into undo_conflict, and rethrows anything else", async () => {
    mocks.restoreGoal.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    expect(await undoDeletion(rememberUndo("user-a", goal))).toEqual({ ok: false, error: "undo_conflict" });
    mocks.restoreGoal.mockRejectedValueOnce(new Error("boom"));
    await expect(undoDeletion(rememberUndo("user-a", goal))).rejects.toThrow("boom");
  });
});

describe("isRestoreConflict", () => {
  it("recognizes unique and foreign-key violations only", () => {
    expect(isRestoreConflict({ code: "P2002" })).toBe(true);
    expect(isRestoreConflict({ code: "P2003" })).toBe(true);
    expect(isRestoreConflict({ code: "P2025" })).toBe(false);
    expect(isRestoreConflict(null)).toBe(false);
    expect(isRestoreConflict(new Error("x"))).toBe(false);
  });
});
