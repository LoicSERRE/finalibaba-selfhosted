import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { generateShareToken, isShareLinkExpired, buildSharedHoldings } from "@/lib/domain/share-links";

describe("generateShareToken", () => {
  it("generates a long, URL-safe, unique token", () => {
    const a = generateShareToken();
    const b = generateShareToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("isShareLinkExpired", () => {
  const now = new Date("2026-08-13T12:00:00.000Z");

  it("is never expired when expiresAt is null (no expiry set)", () => {
    expect(isShareLinkExpired(null, now)).toBe(false);
  });

  it("is expired when expiresAt is in the past", () => {
    expect(isShareLinkExpired(new Date("2026-08-01T00:00:00.000Z"), now)).toBe(true);
  });

  it("is not expired when expiresAt is in the future", () => {
    expect(isShareLinkExpired(new Date("2026-09-01T00:00:00.000Z"), now)).toBe(false);
  });

  it("treats the exact expiry instant as expired", () => {
    expect(isShareLinkExpired(now, now)).toBe(true);
  });
});

describe("buildSharedHoldings", () => {
  it("only includes INVESTMENT/CRYPTO accounts that have at least one holding", () => {
    const result = buildSharedHoldings([
      { id: "a1", name: "PEA", type: "INVESTMENT", holdings: [{ id: "h1", ticker: "AAPL", quantity: new Decimal("10"), lastPriceCents: BigInt(15000) }] },
      { id: "a2", name: "Livret A", type: "SAVINGS", holdings: [] },
      { id: "a3", name: "CTO vide", type: "INVESTMENT", holdings: [] },
      { id: "a4", name: "Crypto", type: "CRYPTO", holdings: [{ id: "h2", ticker: "BTC", quantity: new Decimal("0.5"), lastPriceCents: BigInt(4000000) }] },
    ]);

    expect(result.map((g) => g.accountId)).toEqual(["a4", "a1"]); // "Crypto" < "PEA" alphabetically
  });

  it("computes each holding's value and the account's total from quantity * lastPriceCents", () => {
    const result = buildSharedHoldings([
      {
        id: "a1",
        name: "PEA",
        type: "INVESTMENT",
        holdings: [
          { id: "h1", ticker: "AAPL", quantity: new Decimal("10"), lastPriceCents: BigInt(15000) },
          { id: "h2", ticker: "MSFT", quantity: new Decimal("2"), lastPriceCents: BigInt(30000) },
        ],
      },
    ]);

    expect(result[0].totalCents).toBe(BigInt(150000) + BigInt(60000));
    expect(result[0].holdings.map((h) => h.valueCents)).toEqual([BigInt(150000), BigInt(60000)]);
  });

  it("sorts holdings within an account by value descending", () => {
    const result = buildSharedHoldings([
      {
        id: "a1",
        name: "PEA",
        type: "INVESTMENT",
        holdings: [
          { id: "h1", ticker: "SMALL", quantity: new Decimal("1"), lastPriceCents: BigInt(100) },
          { id: "h2", ticker: "BIG", quantity: new Decimal("1"), lastPriceCents: BigInt(100000) },
        ],
      },
    ]);

    expect(result[0].holdings.map((h) => h.ticker)).toEqual(["BIG", "SMALL"]);
  });

  it("returns an empty array when there are no eligible accounts", () => {
    expect(buildSharedHoldings([{ id: "a1", name: "Courant", type: "CHECKING", holdings: [] }])).toEqual([]);
  });

  it("preserves input order for two holdings of exactly equal value", () => {
    const result = buildSharedHoldings([
      {
        id: "a1",
        name: "PEA",
        type: "INVESTMENT",
        holdings: [
          { id: "h1", ticker: "AAPL", quantity: new Decimal("1"), lastPriceCents: BigInt(10000) },
          { id: "h2", ticker: "MSFT", quantity: new Decimal("1"), lastPriceCents: BigInt(10000) },
        ],
      },
    ]);

    expect(result[0].holdings.map((h) => h.ticker)).toEqual(["AAPL", "MSFT"]);
  });
});
