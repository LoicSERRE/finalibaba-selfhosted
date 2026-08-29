import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Light coverage only, per this project's stated lib/actions/* boundary
// (see sonar-project.properties' sonar.coverage.exclusions comment) - same
// shape as __tests__/totp-actions.test.ts and
// __tests__/transaction-splits-actions.test.ts. Added specifically for
// assertGoalAccountEligible - the Settings picker only ever offers
// non-LOAN accounts, but a Server Action is directly invocable regardless
// of what's rendered, and a goal silently linked to a LOAN account would
// always show 0% progress with no explanation (lib/domain/analytics.ts's
// assetRows deliberately excludes LOAN accounts).
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { accountFindUniqueMock, goalCreateMock, goalUpdateMock } = vi.hoisted(() => ({
  accountFindUniqueMock: vi.fn(),
  goalCreateMock: vi.fn(),
  goalUpdateMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    account: { findUnique: accountFindUniqueMock },
    goal: { create: goalCreateMock, update: goalUpdateMock },
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

import { createGoal, updateGoal } from "@/lib/actions/goals";

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  accountFindUniqueMock.mockReset();
  goalCreateMock.mockReset().mockResolvedValue({});
  goalUpdateMock.mockReset().mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("createGoal - account eligibility", () => {
  it("skips the account lookup entirely when accountId is empty (net-worth-tracking goal)", async () => {
    await createGoal(fd({ name: "Patrimoine", targetCents: "500000" }));
    expect(accountFindUniqueMock).not.toHaveBeenCalled();
    expect(goalCreateMock).toHaveBeenCalledWith({ data: expect.objectContaining({ accountId: null }) });
  });

  it("creates the goal when the linked account exists and isn't a LOAN", async () => {
    accountFindUniqueMock.mockResolvedValue({ type: "SAVINGS" });
    await createGoal(fd({ name: "Fonds d'urgence", targetCents: "20000", accountId: "acc-1" }));
    expect(goalCreateMock).toHaveBeenCalledWith({ data: expect.objectContaining({ accountId: "acc-1" }) });
  });

  it("rejects a LOAN account without ever writing the goal", async () => {
    accountFindUniqueMock.mockResolvedValue({ type: "LOAN" });
    await expect(createGoal(fd({ name: "Bypass", targetCents: "1000", accountId: "loan-1" }))).rejects.toThrow(
      "Un prêt ne peut pas être lié à un objectif d'épargne.",
    );
    expect(goalCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a nonexistent account without ever writing the goal", async () => {
    accountFindUniqueMock.mockResolvedValue(null);
    await expect(createGoal(fd({ name: "Bypass", targetCents: "1000", accountId: "ghost" }))).rejects.toThrow(
      "Compte introuvable.",
    );
    expect(goalCreateMock).not.toHaveBeenCalled();
  });
});

describe("updateGoal - account eligibility", () => {
  it("applies the same LOAN check as createGoal", async () => {
    accountFindUniqueMock.mockResolvedValue({ type: "LOAN" });
    await expect(
      updateGoal("goal-1", fd({ name: "Bypass", targetCents: "1000", accountId: "loan-1" })),
    ).rejects.toThrow("Un prêt ne peut pas être lié à un objectif d'épargne.");
    expect(goalUpdateMock).not.toHaveBeenCalled();
  });
});
