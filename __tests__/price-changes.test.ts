import { describe, expect, it } from "vitest";
import { detectPriceIncrease, occurrencesPerYear } from "@/lib/domain/price-changes";
import { isMissed } from "@/lib/domain/recurring";

/**
 * v2.20: a recurring expense that came in dearer is a price increase - and
 * no longer a "missed" payment, which is what the page showed before.
 */

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d, 12));
const netflix = {
  accountId: "acc1",
  label: "NETFLIX.COM",
  amountCents: BigInt(-13_49),
  amountVaries: false,
  frequency: "MONTHLY" as const,
  intervalCount: 1,
  anchorDate: utc(2026, 0, 15),
};
const asOf = utc(2026, 9, 20); // latest expected: Oct 15
const charge = (cents: number, date = utc(2026, 9, 15), label = "Netflix.com") => ({ accountId: "acc1", label, amountCents: BigInt(-cents), date });

describe("detectPriceIncrease", () => {
  it("reports the new price and what it costs a year", () => {
    const increase = detectPriceIncrease(netflix, [charge(13_49, utc(2026, 8, 15)), charge(14_99)], asOf);
    expect(increase).toEqual({ fromCents: BigInt(-13_49), toCents: BigInt(-14_99), date: utc(2026, 9, 15), yearlyExtraCents: BigInt(18_00) });
  });

  it("stays quiet on the same price, a cheaper one, and exchange-rate noise", () => {
    expect(detectPriceIncrease(netflix, [charge(13_49)], asOf)).toBeNull();
    expect(detectPriceIncrease(netflix, [charge(11_99)], asOf)).toBeNull();
    // 13,49 -> 13,62: +1%, +0,13 - a USD subscription moving with the rate.
    expect(detectPriceIncrease(netflix, [charge(13_62)], asOf)).toBeNull();
  });

  it("does not take another purchase under the same label for a new price", () => {
    // +150%: a 33,99 purchase that happens to share a generic card label.
    expect(detectPriceIncrease(netflix, [charge(33_99)], asOf)).toBeNull();
  });

  it("only reads the charge on the expected date", () => {
    expect(detectPriceIncrease(netflix, [charge(14_99, utc(2026, 9, 1))], asOf)).toBeNull();
    expect(detectPriceIncrease(netflix, [charge(14_99, utc(2026, 9, 18))], asOf)).not.toBeNull();
  });

  it("ignores income and amounts that vary by nature", () => {
    expect(detectPriceIncrease({ ...netflix, amountCents: BigInt(13_49) }, [{ ...charge(0), amountCents: BigInt(14_99) }], asOf)).toBeNull();
    expect(detectPriceIncrease({ ...netflix, amountVaries: true }, [charge(14_99)], asOf)).toBeNull();
  });

  it("scales the yearly extra with the cadence", () => {
    expect(occurrencesPerYear("MONTHLY", 3)).toBe(4);
    expect(occurrencesPerYear("WEEKLY", 2)).toBe(26);
    const yearly = { ...netflix, frequency: "YEARLY" as const, amountCents: BigInt(-400_00), anchorDate: utc(2025, 9, 15) };
    expect(detectPriceIncrease(yearly, [charge(424_00)], asOf)?.yearlyExtraCents).toBe(BigInt(24_00));
  });
});

describe("isMissed - a new price was paid", () => {
  it("no longer reports a dearer charge as missed", () => {
    // 13,49 -> 19,99: +6,50, past the 5 EUR / 10% tolerance it used to need.
    expect(isMissed(netflix, [charge(19_99)], asOf)).toBe(false);
  });

  it("still reports a miss when the only charge is something else", () => {
    expect(isMissed(netflix, [charge(33_99)], asOf)).toBe(true);
  });
});
