import { describe, expect, it } from "vitest";
import { upcomingOccurrences, type UpcomingSeries } from "@/lib/domain/upcoming";

/**
 * The dashboard's month ahead (v2.16): which occurrences fall in the window,
 * in which order, and what they add up to in each direction.
 */
const NOW = new Date("2026-10-20T12:00:00.000Z");
const series = (over: Partial<UpcomingSeries>): UpcomingSeries => ({
  id: "s", label: "X", amountCents: BigInt(-1000), amountVaries: false,
  frequency: "MONTHLY", intervalCount: 1, anchorDate: new Date("2026-01-05T12:00:00.000Z"), ...over,
});

describe("upcomingOccurrences", () => {
  it("lists what falls in the next 30 days, soonest first", () => {
    const { occurrences } = upcomingOccurrences(
      [
        series({ id: "rent", label: "Loyer", anchorDate: new Date("2026-01-05T12:00:00.000Z"), amountCents: BigInt(-80000) }),
        series({ id: "salary", label: "Salaire", anchorDate: new Date("2026-01-28T12:00:00.000Z"), amountCents: BigInt(320000) }),
      ],
      NOW
    );
    expect(occurrences.map((o) => [o.seriesId, o.date.toISOString().slice(0, 10)])).toEqual([
      ["salary", "2026-10-28"],
      ["rent", "2026-11-05"],
    ]);
  });

  it("repeats a weekly series and skips a yearly one outside the window", () => {
    const { occurrences } = upcomingOccurrences(
      [
        series({ id: "w", frequency: "WEEKLY", anchorDate: new Date("2026-10-21T12:00:00.000Z") }),
        series({ id: "y", frequency: "YEARLY", anchorDate: new Date("2026-03-01T12:00:00.000Z") }),
      ],
      NOW
    );
    expect(occurrences.filter((o) => o.seriesId === "w")).toHaveLength(5);
    expect(occurrences.some((o) => o.seriesId === "y")).toBe(false);
  });

  it("totals money in and out separately", () => {
    const { inCents, outCents } = upcomingOccurrences(
      [series({ id: "a", amountCents: BigInt(500) }), series({ id: "b", amountCents: BigInt(-300) }), series({ id: "c", amountCents: BigInt(-200) })],
      NOW
    );
    expect(inCents).toBe(BigInt(500));
    expect(outCents).toBe(BigInt(-500));
  });

  it("is empty with no series", () => {
    expect(upcomingOccurrences([], NOW)).toEqual({ occurrences: [], inCents: BigInt(0), outCents: BigInt(0) });
  });
});
