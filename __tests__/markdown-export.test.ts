import { describe, expect, it } from "vitest";
import { fmt, sign } from "@/lib/utils/markdown-export";

// The two pure helpers behind every Markdown export (accounts, analytics, tax
// report). They were at 40% coverage: `fmt` is what decides whether a real
// figure survives the round trip into a downloadable document, and it has
// already caused one production bug - a 0,46 EUR dividend rendering as "0 €"
// in the tax-report export because the caller took the 0-decimal default while
// the page itself showed two. These pin the behaviour both call styles rely on.
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

describe("sign", () => {
  it("prefixes a plus only for non-negative numbers", () => {
    expect(sign(1)).toBe("+");
    expect(sign(0)).toBe("+");
    expect(sign(-1)).toBe("");
  });

  it("leaves the minus to the formatter, never doubling it", () => {
    // Call sites write `${sign(n)}${fmt(n)}`; if sign returned "-" for
    // negatives the output would read "--1 234 €".
    expect(`${sign(-5000)}${fmt(-5000)}`).toBe(fmt(-5000));
  });
});
