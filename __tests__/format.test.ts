import { describe, expect, it } from "vitest";
import { localeToIntl, formatCurrency, formatPercent, parseCents, centsToEuro } from "@/lib/format";

describe("localeToIntl", () => {
  it("maps 'en' to en-US and everything else to fr-FR", () => {
    expect(localeToIntl("en")).toBe("en-US");
    expect(localeToIntl("fr")).toBe("fr-FR");
    expect(localeToIntl("es")).toBe("fr-FR"); // unsupported locale falls back to the default, not a crash
  });
});

describe("formatCurrency", () => {
  // fr-FR's Intl output uses U+202F/U+00A0 (narrow/no-break spaces), not
  // plain ASCII spaces - assert on the digits/symbol substrings instead of
  // the full string so this doesn't break on an ICU data update.
  it("formats bigint cents as euros with 2 decimals by default", () => {
    const out = formatCurrency(BigInt(123_456));
    expect(out).toContain("1");
    expect(out).toContain("234,56");
    expect(out).toContain("€");
  });

  it("formats plain number cents identically to bigint cents", () => {
    expect(formatCurrency(123_456)).toBe(formatCurrency(BigInt(123_456)));
  });

  it("respects the decimals parameter", () => {
    const out = formatCurrency(BigInt(123_456), 0);
    expect(out).not.toContain(",56");
    expect(out).toContain("235"); // rounded, not truncated: 1234.56 -> 1235
  });

  it("renders negative amounts with a leading minus", () => {
    expect(formatCurrency(BigInt(-5000), 0)).toContain("-50");
  });

  it("renders zero", () => {
    expect(formatCurrency(BigInt(0), 0)).toContain("0");
  });
});

describe("formatPercent", () => {
  it("converts a 0-1 ratio to a percent string", () => {
    const out = formatPercent(0.428);
    expect(out).toContain("42,8");
    expect(out).toContain("%");
  });

  it("respects the decimals parameter", () => {
    expect(formatPercent(0.4, 0)).toContain("40");
    expect(formatPercent(0.4, 0)).not.toContain(",0");
  });
});

describe("parseCents", () => {
  it("parses a comma-decimal French amount", () => {
    expect(parseCents("12,34")).toBe(BigInt(1234));
  });

  it("parses a plain dot-decimal amount", () => {
    expect(parseCents("12.34")).toBe(BigInt(1234));
  });

  it("strips thousand-separator whitespace", () => {
    expect(parseCents("1 234,56")).toBe(BigInt(123_456));
  });

  it("rounds to the nearest cent instead of truncating", () => {
    expect(parseCents("1.006")).toBe(BigInt(101)); // 100.6 -> rounds up to 101
    expect(parseCents("1.004")).toBe(BigInt(100)); // 100.4 -> rounds down to 100
    // Not 1.005: 1.005 * 100 === 100.49999999999999 in IEEE-754 floating
    // point, so Math.round rounds it *down* to 100 - a real, if tiny,
    // sub-cent edge case inherent to any float-based parser, not a bug to
    // paper over here.
  });

  it("falls back to 0 for garbage input instead of throwing - callers rely on this leniency", () => {
    expect(parseCents("N/A")).toBe(BigInt(0));
    expect(parseCents("#REF!")).toBe(BigInt(0));
    expect(parseCents("")).toBe(BigInt(0));
  });

  it("handles a negative amount", () => {
    expect(parseCents("-12,34")).toBe(BigInt(-1234));
  });
});

describe("centsToEuro", () => {
  it("converts cents to a fixed 2-decimal euro string, plain dot separator", () => {
    expect(centsToEuro(BigInt(123_456))).toBe("1234.56");
    expect(centsToEuro(123_456)).toBe("1234.56");
  });

  it("pads whole numbers to 2 decimals", () => {
    expect(centsToEuro(BigInt(500))).toBe("5.00");
  });
});
