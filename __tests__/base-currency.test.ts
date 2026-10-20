import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The instance's base currency (v2.19, dev-docs/currencies.md step 2): what
 * every *Cents column is in, settled at the first boot and never relabelled
 * by a variable afterwards.
 */

const { findUniqueMock, upsertMock, countMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  upsertMock: vi.fn(),
  countMock: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    instanceConfig: { findUnique: findUniqueMock, upsert: upsertMock },
    account: { count: countMock },
  },
}));

import { baseCurrency, currencySymbol, initialBaseCurrency, parseBaseCurrency } from "@/lib/utils/base-currency";
import { withCurrencySymbol } from "@/lib/domain/currency-labels";
import { formatCurrency } from "@/lib/utils/format";
import { settleBaseCurrency } from "@/lib/services/instance-config";

const original = process.env.BASE_CURRENCY;
beforeEach(() => {
  findUniqueMock.mockReset();
  upsertMock.mockReset().mockImplementation(async ({ create }) => create);
  countMock.mockReset();
});
afterEach(() => {
  if (original === undefined) delete process.env.BASE_CURRENCY;
  else process.env.BASE_CURRENCY = original;
});

describe("which bases are accepted", () => {
  it("takes the four a holding can be converted into, EUR otherwise", () => {
    for (const code of ["EUR", "USD", "GBP", "CHF", " usd "]) expect(parseBaseCurrency(code)).toBe(code.trim().toUpperCase());
    for (const raw of [undefined, "", "JPY", "dollar", 42]) expect(parseBaseCurrency(raw)).toBe("EUR");
  });

  it("formats in the base", () => {
    process.env.BASE_CURRENCY = "USD";
    expect(baseCurrency()).toBe("USD");
    expect(formatCurrency(123456)).toBe(new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD" }).format(1234.56));
    delete process.env.BASE_CURRENCY;
    expect(formatCurrency(123456)).toContain("€");
  });

  it("names the symbol unit labels use", () => {
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("CHF")).toBe("CHF");
    expect(currencySymbol("USD")).toMatch(/\$/);
  });
});

describe("the first boot", () => {
  // Every figure stored before v2.19 is EUR: adopting another base over them
  // would relabel them, not convert them.
  it("takes BASE_CURRENCY on a fresh install, EUR once data exists", () => {
    expect(initialBaseCurrency("USD", false)).toBe("USD");
    expect(initialBaseCurrency("USD", true)).toBe("EUR");
    expect(initialBaseCurrency(undefined, false)).toBe("EUR");
  });

  it("stores the requested base on a fresh install", async () => {
    process.env.BASE_CURRENCY = "GBP";
    findUniqueMock.mockResolvedValue(null);
    countMock.mockResolvedValue(0);
    expect(await settleBaseCurrency()).toEqual({ base: "GBP", requested: "GBP" });
    expect(upsertMock.mock.calls[0][0].create).toEqual({ id: "singleton", baseCurrency: "GBP" });
  });

  it("stores EUR on an instance upgraded with data, whatever the variable says", async () => {
    process.env.BASE_CURRENCY = "USD";
    findUniqueMock.mockResolvedValue(null);
    countMock.mockResolvedValue(12);
    expect(await settleBaseCurrency()).toEqual({ base: "EUR", requested: "USD" });
    expect(process.env.BASE_CURRENCY).toBe("EUR");
  });

  it("then the stored base wins, and becomes the process's", async () => {
    process.env.BASE_CURRENCY = "CHF";
    findUniqueMock.mockResolvedValue({ id: "singleton", baseCurrency: "USD" });
    expect(await settleBaseCurrency()).toEqual({ base: "USD", requested: "CHF" });
    expect(upsertMock).not.toHaveBeenCalled();
    expect(process.env.BASE_CURRENCY).toBe("USD");
    expect(baseCurrency()).toBe("USD");
  });
});

describe("unit labels", () => {
  const messages = { budgets: { amount: "Budget mensuel (€)", nested: { min: "Min €" } }, plain: "Sans symbole" };

  it("swap the euro sign for the base's symbol, everywhere", () => {
    expect(withCurrencySymbol(messages, "$US")).toEqual({
      budgets: { amount: "Budget mensuel ($US)", nested: { min: "Min $US" } },
      plain: "Sans symbole",
    });
  });

  it("leave an EUR instance's messages untouched", () => {
    expect(withCurrencySymbol(messages, "€")).toBe(messages);
  });
});
