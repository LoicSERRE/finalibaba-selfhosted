import { describe, expect, it, vi } from "vitest";

/**
 * The goal step must not be ticked by the "Patrimoine" goal every install is
 * born with (migration 20260823174545_add_goals backfills it even on a fresh
 * database). Checked against PostgreSQL by hand when written: the untouched
 * row counts 0, the same row retargeted counts 1.
 */

const { goalCount } = vi.hoisted(() => ({ goalCount: vi.fn(async () => 0) }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    account: { count: vi.fn(async () => 0) },
    userSettings: { findUnique: vi.fn(async () => null) },
    category: { count: vi.fn(async () => 0) },
    goal: { count: goalCount },
  },
}));

import { loadFirstRunFacts } from "@/lib/services/first-run";
import { UNTOUCHED_LEGACY_GOAL } from "@/lib/domain/first-run";

describe("loadFirstRunFacts", () => {
  it("does not count the untouched goal a fresh install is born with", async () => {
    await loadFirstRunFacts("user-owner", []);
    expect(goalCount).toHaveBeenCalledWith({ where: { userId: "user-owner", NOT: UNTOUCHED_LEGACY_GOAL } });
    expect(UNTOUCHED_LEGACY_GOAL).toEqual({
      id: "goal-legacy-networth",
      name: "Patrimoine",
      targetCents: BigInt(5_000_000),
      targetDate: null,
      accountId: null,
    });
  });
});
