import { describe, expect, it } from "vitest";
import { parseCsvDate, isFutureDate, looksNumeric, makeHeaderNormalizer } from "@/lib/csv-import";

describe("parseCsvDate", () => {
  it("passes through a valid ISO date", () => {
    expect(parseCsvDate("2026-07-28")).toBe("2026-07-28");
  });

  it("converts a French DD/MM/YYYY date to ISO", () => {
    expect(parseCsvDate("28/07/2026")).toBe("2026-07-28");
  });

  it("trims surrounding whitespace", () => {
    expect(parseCsvDate("  2026-07-28  ")).toBe("2026-07-28");
  });

  it("rejects an unrecognized format instead of guessing", () => {
    expect(parseCsvDate("07-28-2026")).toBeNull(); // US format, not supported
    expect(parseCsvDate("28 juillet 2026")).toBeNull();
    expect(parseCsvDate("")).toBeNull();
    expect(parseCsvDate("not a date")).toBeNull();
  });

  it("does not swap day/month between the two supported formats", () => {
    // 13th of the month can only be a day, not a month - a real regression
    // here would silently produce a wrong date instead of erroring.
    expect(parseCsvDate("13/01/2026")).toBe("2026-01-13");
  });
});

describe("isFutureDate", () => {
  function isoDaysFromNow(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  it("flags tomorrow as future", () => {
    expect(isFutureDate(isoDaysFromNow(1))).toBe(true);
  });

  it("does not flag today as future", () => {
    expect(isFutureDate(isoDaysFromNow(0))).toBe(false);
  });

  it("does not flag yesterday as future", () => {
    expect(isFutureDate(isoDaysFromNow(-1))).toBe(false);
  });
});

describe("looksNumeric", () => {
  it.each([
    "100",
    "-100",
    "100,50",
    "100.50",
    "1 234,56", // thousands separator
    "  42  ", // surrounding whitespace
  ])("accepts %s", (value) => {
    expect(looksNumeric(value)).toBe(true);
  });

  it.each([
    "N/A",
    "-",
    "pending",
    "#REF!",
    "3.5abc", // the exact case the regex exists to catch - parseFloat would silently accept this and truncate to 3.5
    "",
  ])("rejects %s", (value) => {
    expect(looksNumeric(value)).toBe(false);
  });
});

describe("makeHeaderNormalizer", () => {
  const normalize = makeHeaderNormalizer({ "libellé": "label", "montant": "amount" });

  it("maps a known alias", () => {
    expect(normalize("libellé")).toBe("label");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(normalize("  Montant  ")).toBe("amount");
    expect(normalize("LIBELLÉ")).toBe("label");
  });

  it("falls back to the lowercased header when there's no alias", () => {
    expect(normalize("Date")).toBe("date");
  });
});
