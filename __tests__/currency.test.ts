import { describe, expect, it } from "vitest";
import {
  amountColumns,
  balanceColumns,
  parseAccountCurrency,
  parseYahooDailyRates,
  pickRate,
  redenominate,
  revaluation,
  shiftSnapshots,
  toBaseCents,
} from "@/lib/domain/currency";

/**
 * Accounts kept in another currency (v2.18, dev-docs/currencies.md). Every
 * *Cents column stays EUR; these are the conversions and the rate picking
 * that decide what gets written beside it.
 */

describe("which accounts get a currency", () => {
  it("only cash accounts, and only from the offered list", () => {
    expect(parseAccountCurrency("USD", "CHECKING")).toBe("USD");
    expect(parseAccountCurrency("CHF", "SAVINGS")).toBe("CHF");
    // Investments convert per holding; property, cars and loans stay EUR.
    for (const type of ["INVESTMENT", "CRYPTO", "REAL_ESTATE", "AUTOMOBILE", "LOAN", "MEAL_VOUCHER"]) {
      expect(parseAccountCurrency("USD", type)).toBe("EUR");
    }
    for (const raw of [null, "", "usd", "XYZ", 42]) expect(parseAccountCurrency(raw, "CHECKING")).toBe("EUR");
  });
});

describe("conversion", () => {
  it("rounds to the cent", () => {
    expect(toBaseCents(BigInt(10_000), 0.91234)).toBe(BigInt(9_123));
    expect(toBaseCents(BigInt(-10_000), 0.91236)).toBe(BigInt(-9_124));
    expect(toBaseCents(BigInt(0), 0.9)).toBe(BigInt(0));
  });

  it("leaves an EUR figure alone and records no native column", () => {
    expect(balanceColumns("EUR", BigInt(1_234), 1)).toEqual({ balanceCents: BigInt(1_234), nativeBalanceCents: null, fxRate: null });
    expect(amountColumns("EUR", BigInt(-50), null)).toEqual({ amountCents: BigInt(-50), nativeAmountCents: null, fxRate: null });
  });

  it("stores a foreign figure as EUR, with what it came from", () => {
    expect(balanceColumns("USD", BigInt(10_000), 0.9)).toEqual({ balanceCents: BigInt(9_000), nativeBalanceCents: BigInt(10_000), fxRate: 0.9 });
  });

  it("never converts without a rate", () => {
    expect(() => balanceColumns("USD", BigInt(1), null)).toThrow();
  });
});

describe("shifting snapshots by a native amount", () => {
  it("re-converts each foreign row at its own rate", () => {
    const rows = [
      { id: "a", balanceCents: BigInt(9_000), nativeBalanceCents: BigInt(10_000), fxRate: 0.9 },
      { id: "b", balanceCents: BigInt(16_000), nativeBalanceCents: BigInt(20_000), fxRate: 0.8 },
    ];
    expect(shiftSnapshots(rows, BigInt(-1_000))).toEqual([
      { id: "a", balanceCents: BigInt(8_100), nativeBalanceCents: BigInt(9_000), fxRate: 0.9 },
      { id: "b", balanceCents: BigInt(15_200), nativeBalanceCents: BigInt(19_000), fxRate: 0.8 },
    ]);
  });

  it("moves an EUR row by the amount itself", () => {
    const rows = [{ id: "a", balanceCents: BigInt(5_000), nativeBalanceCents: null, fxRate: null }];
    expect(shiftSnapshots(rows, BigInt(250))[0].balanceCents).toBe(BigInt(5_250));
  });
});

describe("picking a day's rate", () => {
  const rows = [
    { day: "2026-03-05", rate: 0.91 }, // Thursday
    { day: "2026-03-06", rate: 0.92 }, // Friday
  ];

  it("takes the day's own close", () => {
    expect(pickRate(rows, "2026-03-05")).toBeCloseTo(0.91, 10);
  });

  it("carries Friday's close over the weekend", () => {
    expect(pickRate(rows, "2026-03-08")).toBeCloseTo(0.92, 10);
  });

  it("never reaches into the future, nor more than a week back", () => {
    expect(pickRate(rows, "2026-03-04")).toBeNull();
    expect(pickRate(rows, "2026-03-14")).toBeNull();
    expect(pickRate([], "2026-03-05")).toBeNull();
  });
});

describe("Yahoo's daily closes", () => {
  // EURUSD=X quotes "USD per 1 EUR"; the app wants EUR per 1 USD.
  const at = (day: string) => Date.parse(`${day}T23:00:00Z`) / 1000;

  it("inverts each close and keys it by day", () => {
    const json = {
      chart: { result: [{ timestamp: [at("2026-03-05"), at("2026-03-06")], indicators: { quote: [{ close: [1.25, 1.0] }] } }] },
    };
    expect(parseYahooDailyRates(json)).toEqual([
      { day: "2026-03-05", rate: 0.8 },
      { day: "2026-03-06", rate: 1 },
    ]);
  });

  it("drops empty closes and survives a malformed answer", () => {
    const json = { chart: { result: [{ timestamp: [at("2026-03-05"), at("2026-03-06")], indicators: { quote: [{ close: [null, 0] }] } }] } };
    expect(parseYahooDailyRates(json)).toEqual([]);
    expect(parseYahooDailyRates(null)).toEqual([]);
    expect(parseYahooDailyRates({ chart: { result: [] } })).toEqual([]);
  });
});

describe("revaluing a foreign account the rate has moved under", () => {
  const TODAY = new Date("2026-03-10T12:00:00.000Z");
  const yesterday = { recordedAt: new Date("2026-03-09T12:00:00Z"), balanceCents: BigInt(9_000), nativeBalanceCents: BigInt(10_000) };

  it("writes today's EUR value of the same dollars, at noon", () => {
    expect(revaluation(yesterday, "USD", 0.85, TODAY)).toEqual({
      recordedAt: TODAY,
      balanceCents: BigInt(8_500),
      nativeBalanceCents: BigInt(10_000),
      fxRate: 0.85,
    });
  });

  it("writes nothing when the value would not change", () => {
    expect(revaluation(yesterday, "USD", 0.9, TODAY)).toBeNull();
  });

  // Rates are daily: a row from today was converted at today's rate already,
  // and one at noon is where a correction typed later today will land.
  it("writes nothing when today already has a row", () => {
    expect(revaluation({ ...yesterday, recordedAt: new Date("2026-03-10T08:00:00Z") }, "USD", 0.85, TODAY)).toBeNull();
    expect(revaluation({ ...yesterday, recordedAt: new Date("2026-03-10T19:00:00Z") }, "USD", 0.85, TODAY)).toBeNull();
  });

  it("leaves EUR accounts and rows without a native figure alone", () => {
    expect(revaluation(yesterday, "EUR", 0.85, TODAY)).toBeNull();
    expect(revaluation({ ...yesterday, nativeBalanceCents: null }, "USD", 0.85, TODAY)).toBeNull();
  });
});

// Step 1b: a synced account created before v2.18 was EUR whatever its bank
// held, so its stored figures are the bank's own numbers.
describe("re-denominating a history stored as EUR", () => {
  const rows = [
    { id: "a", cents: BigInt(10_000), day: "2026-03-05" },
    { id: "b", cents: BigInt(-500), day: "2026-03-06" },
  ];

  it("keeps each figure as the native one and converts it at its own day's rate", () => {
    const rates = new Map([["2026-03-05", 0.8], ["2026-03-06", 0.9]]);
    expect(redenominate(rows, rates)).toEqual([
      { id: "a", native: BigInt(10_000), base: BigInt(8_000), rate: 0.8 },
      { id: "b", native: BigInt(-500), base: BigInt(-450), rate: 0.9 },
    ]);
  });

  it("rewrites nothing when any day cannot be priced", () => {
    expect(redenominate(rows, new Map([["2026-03-05", 0.8], ["2026-03-06", null]]))).toBeNull();
    expect(redenominate(rows, new Map([["2026-03-05", 0.8]]))).toBeNull();
  });
});
