import { describe, expect, it } from "vitest";
import { isFutureDate, looksNumeric, makeHeaderNormalizer, parseCsvDate, parseImportedCents } from "@/lib/domain/csv-import";

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

describe("parseCsvDate rejects a date that only looks like one", () => {
  // `new Date("2026-02-30")` does not fail, it rolls forward - so a typo
  // landed on a different day, silently, on a row the preview had accepted.
  it.each([
    ["2026-02-30", "the 30th of February"],
    ["2026-04-31", "the 31st of April"],
    ["2025-02-29", "a leap day in a non-leap year"],
    ["2026-13-01", "a thirteenth month"],
    ["31/04/2026", "the same, written the French way"],
  ])("%s (%s)", (raw) => {
    expect(parseCsvDate(raw)).toBeNull();
  });

  it("still accepts a real leap day", () => {
    expect(parseCsvDate("2028-02-29")).toBe("2028-02-29");
    expect(parseCsvDate("29/02/2028")).toBe("2028-02-29");
  });
});

describe("parseImportedCents", () => {
  it("reads a comma before three digits as a thousands separator", () => {
    // The reported defect: parseCents replaces the first comma with a dot, so
    // a file exported with the comma grouping thousands turned 1 234 EUR into
    // 1,23 EUR - a thousandfold error with nothing on screen to notice.
    expect(parseImportedCents("1,234")).toBe(BigInt(123_400));
    expect(parseImportedCents("1,234,567")).toBe(BigInt(123_456_700));
  });

  it("still reads a comma before two digits as a decimal separator", () => {
    expect(parseImportedCents("12,34")).toBe(BigInt(1_234));
    expect(parseImportedCents("-12,34")).toBe(BigInt(-1_234));
    expect(parseImportedCents("0,5")).toBe(BigInt(50));
  });

  it("lets position decide when both separators are present", () => {
    // Whichever comes last is the decimal one, in either locale's convention.
    expect(parseImportedCents("1.234,56")).toBe(BigInt(123_456));
    expect(parseImportedCents("1,234.56")).toBe(BigInt(123_456));
  });

  it("handles a space-grouped amount and a bare integer", () => {
    expect(parseImportedCents("1 234,56")).toBe(BigInt(123_456));
    expect(parseImportedCents("1234")).toBe(BigInt(123_400));
    expect(parseImportedCents("-1 234")).toBe(BigInt(-123_400));
  });

  it("returns zero for something that is not a number at all", () => {
    expect(parseImportedCents("N/A")).toBe(BigInt(0));
  });
});
