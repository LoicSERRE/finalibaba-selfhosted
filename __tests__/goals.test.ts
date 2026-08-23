import { describe, expect, it } from "vitest";
import { computeGoalProgress } from "@/lib/domain/goals";

describe("computeGoalProgress", () => {
  it("returns 0% when nothing has been saved yet", () => {
    expect(computeGoalProgress(BigInt(0), BigInt(8000_00))).toEqual({ pct: 0, remaining: BigInt(8000_00) });
  });

  it("computes a partial percentage and remaining amount", () => {
    expect(computeGoalProgress(BigInt(40000_00), BigInt(80000_00))).toEqual({ pct: 50, remaining: BigInt(40000_00) });
  });

  it("reports exactly 100% with nothing remaining when the target is met", () => {
    expect(computeGoalProgress(BigInt(8000_00), BigInt(8000_00))).toEqual({ pct: 100, remaining: BigInt(0) });
  });

  it("caps at 100% and floors remaining at 0 when the target is exceeded", () => {
    expect(computeGoalProgress(BigInt(9000_00), BigInt(8000_00))).toEqual({ pct: 100, remaining: BigInt(0) });
  });

  it("guards against a non-positive target instead of dividing by zero", () => {
    expect(computeGoalProgress(BigInt(1000_00), BigInt(0))).toEqual({ pct: 0, remaining: BigInt(0) });
    expect(computeGoalProgress(BigInt(1000_00), BigInt(-500_00))).toEqual({ pct: 0, remaining: BigInt(0) });
  });
});
