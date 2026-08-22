import { describe, expect, it } from "vitest";
import { parseTransactionLedgerFilters, dayAfter, amountMagnitudeRanges } from "@/lib/domain/transactions-ledger";

describe("parseTransactionLedgerFilters", () => {
  it("defaults every filter to null and page to 1 when nothing is provided", () => {
    expect(parseTransactionLedgerFilters({})).toEqual({
      q: null,
      accountId: null,
      categoryId: null,
      from: null,
      to: null,
      amountMin: null,
      amountMax: null,
      page: 1,
    });
  });

  it("trims and nulls out a blank search query", () => {
    expect(parseTransactionLedgerFilters({ q: "   " }).q).toBeNull();
    expect(parseTransactionLedgerFilters({ q: "  amazon  " }).q).toBe("amazon");
  });

  it("parses from/to as noon UTC on the given day", () => {
    const result = parseTransactionLedgerFilters({ from: "2026-01-01", to: "2026-01-31" });
    expect(result.from).toEqual(new Date("2026-01-01T12:00:00.000Z"));
    expect(result.to).toEqual(new Date("2026-01-31T12:00:00.000Z"));
  });

  it("treats an invalid date as no filter rather than throwing", () => {
    expect(parseTransactionLedgerFilters({ from: "not-a-date" }).from).toBeNull();
  });

  it("clamps a non-numeric or negative page to 1", () => {
    expect(parseTransactionLedgerFilters({ page: "abc" }).page).toBe(1);
    expect(parseTransactionLedgerFilters({ page: "-5" }).page).toBe(1);
    expect(parseTransactionLedgerFilters({ page: "0" }).page).toBe(1);
  });

  it("passes through a valid page number", () => {
    expect(parseTransactionLedgerFilters({ page: "3" }).page).toBe(3);
  });

  it("parses amountMin/amountMax as cents, accepting a comma decimal separator", () => {
    const result = parseTransactionLedgerFilters({ amountMin: "50", amountMax: "1 234,56" });
    expect(result.amountMin).toBe(BigInt(5000));
    expect(result.amountMax).toBe(BigInt(123456));
  });

  it("treats a blank, negative, or non-numeric amount as no filter rather than 0", () => {
    expect(parseTransactionLedgerFilters({ amountMin: "" }).amountMin).toBeNull();
    expect(parseTransactionLedgerFilters({ amountMin: "-10" }).amountMin).toBeNull();
    expect(parseTransactionLedgerFilters({ amountMin: "abc" }).amountMin).toBeNull();
  });
});

describe("dayAfter", () => {
  it("returns the exact next calendar day (24h later)", () => {
    expect(dayAfter(new Date("2026-01-31T12:00:00.000Z"))).toEqual(new Date("2026-02-01T12:00:00.000Z"));
  });
});

describe("amountMagnitudeRanges", () => {
  it("returns null when neither bound is set", () => {
    expect(amountMagnitudeRanges(null, null)).toBeNull();
  });

  it("expresses a min-only filter as |amount| >= min on both sides", () => {
    const [positive, negative] = amountMagnitudeRanges(BigInt(5000), null)!;
    expect(positive).toEqual({ gte: BigInt(5000) });
    expect(negative).toEqual({ lte: BigInt(-5000) });
  });

  it("expresses a max-only filter as a single contiguous [-max, max] range, not two OR'd halves", () => {
    // A two-range OR here would be `(x <= max) OR (x >= -max)`, which is a
    // tautology (always true) - this is the exact regression this test guards.
    const ranges = amountMagnitudeRanges(null, BigInt(10000))!;
    expect(ranges).toEqual([{ gte: BigInt(-10000), lte: BigInt(10000) }]);
  });

  it("expresses a min+max filter as a symmetric band on both sides", () => {
    const [positive, negative] = amountMagnitudeRanges(BigInt(5000), BigInt(10000))!;
    expect(positive).toEqual({ gte: BigInt(5000), lte: BigInt(10000) });
    expect(negative).toEqual({ gte: BigInt(-10000), lte: BigInt(-5000) });
  });
});
