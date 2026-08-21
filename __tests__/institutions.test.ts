import { describe, expect, it } from "vitest";
import { historyDepthLossDays, HISTORY_DEPTH_WARNING_DAYS } from "@/lib/domain/institutions";

describe("historyDepthLossDays", () => {
  it("returns null when either side has no history yet", () => {
    expect(historyDepthLossDays(null, new Date("2026-08-01"))).toBeNull();
    expect(historyDepthLossDays(new Date("2026-08-01"), null)).toBeNull();
    expect(historyDepthLossDays(null, null)).toBeNull();
  });

  it("returns null when the gap is within the warning threshold", () => {
    const legacy = new Date("2026-08-01T00:00:00.000Z");
    const woob = new Date("2026-08-10T00:00:00.000Z"); // 9 days, well under 60
    expect(historyDepthLossDays(legacy, woob)).toBeNull();
  });

  it("returns null when Woob's history starts before or the same day as the legacy side", () => {
    const legacy = new Date("2026-08-10T00:00:00.000Z");
    const woob = new Date("2026-08-01T00:00:00.000Z");
    expect(historyDepthLossDays(legacy, woob)).toBeNull();
  });

  it("returns the day gap once it exceeds the warning threshold", () => {
    const legacy = new Date("2024-05-28T00:00:00.000Z");
    const woob = new Date("2026-08-17T00:00:00.000Z"); // the real production incident's own gap
    const days = historyDepthLossDays(legacy, woob);
    expect(days).not.toBeNull();
    expect(days).toBeGreaterThan(HISTORY_DEPTH_WARNING_DAYS);
  });

  it("treats a gap of exactly the threshold as not warning-worthy", () => {
    const legacy = new Date("2026-01-01T00:00:00.000Z");
    const woob = new Date(legacy.getTime() + HISTORY_DEPTH_WARNING_DAYS * 24 * 60 * 60 * 1000);
    expect(historyDepthLossDays(legacy, woob)).toBeNull();
  });
});
