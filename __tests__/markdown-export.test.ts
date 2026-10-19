import { describe, expect, it } from "vitest";
import { exportFormat, nameMentions } from "@/lib/utils/markdown-export";

// The formatter behind every Markdown export (accounts, analytics, tax
// report). `money` is what decides whether a real figure survives the round
// trip into a downloadable document, and it has already caused one production
// bug - a 0,46 EUR dividend rendering as "0 €" in the tax-report export
// because the caller took the 0-decimal default while the page itself showed
// two. These pin the behaviour every call site relies on, in both languages.
//
// downloadFile is deliberately not covered: it is DOM plumbing (Blob,
// createObjectURL, a synthetic click) with no logic of its own, and asserting
// against a jsdom stub would test the stub.

// fr-FR formatting uses a narrow no-break space as the thousands separator and
// a non-breaking space before the currency symbol. Building the expectation
// with the same Intl call rather than typing the literal avoids a test that
// fails on an ICU data change while the code is still correct.
const expected = (value: number, decimals: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(value);

const fr = exportFormat("fr-FR");
const en = exportFormat("en-US");
const fmt = fr.money;

describe("fmt", () => {
  it("takes cents and renders euros", () => {
    expect(fmt(123_456)).toBe(expected(1234.56, 0));
  });

  it("defaults to no decimals, which rounds", () => {
    expect(fmt(150)).toBe(expected(1.5, 0));
    expect(fmt(46)).toBe(expected(0.46, 0));
  });

  it("keeps small real amounts when asked for 2 decimals", () => {
    // The tax-report regression: this call site must pass 2, or a 0,46 EUR
    // dividend disappears into "0 €" inside a document meant to be declarable.
    expect(fmt(46, 2)).toBe(expected(0.46, 2));
    expect(fmt(46, 2)).not.toBe(fmt(46));
  });

  it("handles zero and negatives", () => {
    expect(fmt(0)).toBe(expected(0, 0));
    expect(fmt(-123_456, 2)).toBe(expected(-1234.56, 2));
  });

  it("pads to the requested decimals rather than trimming", () => {
    expect(fmt(100, 2)).toBe(expected(1, 2));
  });
});

describe("signedMoney", () => {
  it("adds a plus to zero and positives only", () => {
    expect(fr.signedMoney(5000)).toBe(`+${fmt(5000)}`);
    expect(fr.signedMoney(0)).toBe(`+${fmt(0)}`);
    expect(fr.signedMoney(-5000)).toBe(fmt(-5000));
  });

  it("never doubles the minus", () => {
    expect(fr.signedMoney(-5000)).not.toContain("--");
    expect(en.signedMoney(-5000)).toBe("-€50");
  });
});

describe("one document, one language", () => {
  it("formats amounts the English way in English", () => {
    expect(en.money(123_456)).toBe("€1,235");
    expect(en.money(46, 2)).toBe("€0.46");
    expect(en.signedMoney(190_000)).toBe("+€1,900");
  });

  it("formats percentages per language, French with its space", () => {
    expect(en.pct(12.5)).toBe("12.5%");
    expect(en.signedPct(-3, 1)).toBe("-3.0%");
    expect(fr.pct(12.5)).toBe(new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 2 }).format(0.125));
    expect(fr.pct(12.5)).toMatch(/^12,5\s%$/u);
  });

  it("keeps a raw percentage as it is, up to two decimals", () => {
    expect(en.pct(73)).toBe("73%");
    expect(en.pct(33.333)).toBe("33.33%");
  });

  // The pages print these figures with toFixed; Intl alone rounds a binary
  // half the other way, and the export must not disagree with the screen.
  it("rounds a fixed-digit percentage exactly as the pages do", () => {
    expect(en.signedPct(23.45, 1)).toBe(`+${(23.45).toFixed(1)}%`);
    expect(en.pct(1.9, 2)).toBe("1.90%");
  });

  it("formats quantities and dates in the document's language", () => {
    expect(en.quantity("1234.5")).toBe("1,234.5");
    expect(fr.quantity("12.5")).toBe("12,5");
    expect(fr.quantity("0.00012345")).toBe("0,00012345");
    const d = new Date("2026-07-28T12:00:00.000Z");
    expect(en.longDate(d)).toBe("July 28, 2026");
    expect(fr.longDate(d)).toBe("28 juillet 2026");
    expect(en.shortDate(d)).toBe("Jul 28, 2026");
  });
});

describe("nameMentions", () => {
  it("finds a qualifier the name already says, whatever the case or accents", () => {
    expect(nameMentions("PEA", "PEA")).toBe(true);
    expect(nameMentions("Mon pea", "PEA")).toBe(true);
    expect(nameMentions("Épargne", "epargne")).toBe(true);
  });

  it("only matches whole words", () => {
    expect(nameMentions("PEAGE", "PEA")).toBe(false);
    expect(nameMentions("Bourso", "PEA")).toBe(false);
  });

  it("treats regex characters literally and an empty qualifier as absent", () => {
    expect(nameMentions("PEA-PME", "PEA-PME")).toBe(true);
    expect(nameMentions("a.b", "a+b")).toBe(false);
    expect(nameMentions("PEA", "")).toBe(false);
  });
});
