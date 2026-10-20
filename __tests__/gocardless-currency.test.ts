import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GoCardless accounts in another currency (v2.18, dev-docs/currencies.md
 * step 1b): the balance and every booked transaction stored as EUR with the
 * bank's own figure beside it, and nothing stored at a guessed rate. Light
 * coverage of the sequence, per the lib/actions/* boundary.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const m = vi.hoisted(() => ({
  accountFindMany: vi.fn(),
  balanceCreate: vi.fn(),
  txCreateMany: vi.fn(),
  getAccountBalances: vi.fn(),
  getTransactions: vi.fn(),
  resolveCurrency: vi.fn(),
  rate: vi.fn(),
  rates: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    account: { findMany: m.accountFindMany },
    historicalBalance: { create: m.balanceCreate },
    transaction: { createMany: m.txCreateMany },
  },
}));
vi.mock("@/lib/auth-context", () => ({
  getViewer: vi.fn(async () => ({ id: "user-owner" })),
  assertOwned: vi.fn(async () => {}),
}));
vi.mock("@/lib/actions/auto-categorize", () => ({ autoCategorizeTransactions: vi.fn() }));
vi.mock("@/lib/services/gocardless", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/gocardless")>()),
  getAccountBalances: m.getAccountBalances,
  getTransactions: m.getTransactions,
}));
vi.mock("@/lib/services/account-currency", () => ({ resolveSyncedAccountCurrency: m.resolveCurrency }));
vi.mock("@/lib/services/exchange-rate", () => ({ rateToEurOn: m.rate, ratesToEurForDays: m.rates }));

import { syncGocardlessBalances, syncGocardlessTransactions } from "@/lib/actions/gocardless";

const USD_ACCOUNT = { id: "acc-1", gocardlessAccountId: "gc-1", currency: "USD" };
const booked = (id: string, amount: string, day: string, currency = "USD") => ({
  transactionId: id,
  bookingDate: day,
  transactionAmount: { amount, currency },
  remittanceInformationUnstructured: `tx ${id}`,
});

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.accountFindMany.mockResolvedValue([USD_ACCOUNT]);
  m.txCreateMany.mockResolvedValue({ count: 0 });
  m.resolveCurrency.mockResolvedValue("USD");
  m.rate.mockResolvedValue(0.9);
});

describe("syncGocardlessBalances", () => {
  it("stores the dollars beside their EUR value", async () => {
    m.getAccountBalances.mockResolvedValue({
      balances: [{ balanceType: "closingBooked", balanceAmount: { amount: "1000.00", currency: "USD" } }],
    });

    await syncGocardlessBalances("inst-1");

    expect(m.resolveCurrency).toHaveBeenCalledWith("acc-1", "USD");
    expect(m.balanceCreate.mock.calls[0][0].data).toEqual({
      accountId: "acc-1",
      balanceCents: BigInt(90_000),
      nativeBalanceCents: BigInt(100_000),
      fxRate: 0.9,
    });
  });

  it("writes nothing without a rate, or when the currency cannot be settled", async () => {
    m.getAccountBalances.mockResolvedValue({ balances: [{ balanceType: "closingBooked", balanceAmount: { amount: "1", currency: "USD" } }] });
    m.rate.mockResolvedValue(null);
    await syncGocardlessBalances("inst-1");
    m.resolveCurrency.mockResolvedValue(null);
    await syncGocardlessBalances("inst-1");
    expect(m.balanceCreate).not.toHaveBeenCalled();
  });
});

describe("syncGocardlessTransactions", () => {
  it("converts each at its own day's rate, and skips a day nobody can price", async () => {
    m.getTransactions.mockResolvedValue({
      transactions: { booked: [booked("t1", "-10.00", "2026-03-05"), booked("t2", "-20.00", "2026-03-06")], pending: [] },
    });
    m.rates.mockResolvedValue(new Map([["2026-03-05", 0.8], ["2026-03-06", null]]));

    await syncGocardlessTransactions("inst-1");

    expect(m.rates).toHaveBeenCalledWith("USD", ["2026-03-05", "2026-03-06"]);
    const rows = m.txCreateMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      syncId: "gocardless_t1",
      amountCents: BigInt(-800),
      nativeAmountCents: BigInt(-1_000),
      fxRate: 0.8,
    });
  });

  it("skips a transaction in another currency than its account's", async () => {
    m.getTransactions.mockResolvedValue({
      transactions: { booked: [booked("t1", "-10.00", "2026-03-05", "GBP"), booked("t2", "-5.00", "2026-03-05")], pending: [] },
    });
    m.rates.mockResolvedValue(new Map([["2026-03-05", 0.8]]));

    await syncGocardlessTransactions("inst-1");

    const rows = m.txCreateMany.mock.calls[0][0].data;
    expect(rows.map((r: { syncId: string }) => r.syncId)).toEqual(["gocardless_t2"]);
  });

  it("leaves an EUR account exactly as before", async () => {
    m.accountFindMany.mockResolvedValue([{ ...USD_ACCOUNT, currency: "EUR" }]);
    m.getTransactions.mockResolvedValue({ transactions: { booked: [booked("t1", "-12.34", "2026-03-05", "EUR")], pending: [] } });
    m.rates.mockResolvedValue(new Map([["2026-03-05", 1]]));

    await syncGocardlessTransactions("inst-1");

    expect(m.txCreateMany.mock.calls[0][0].data[0]).toMatchObject({ amountCents: BigInt(-1_234), nativeAmountCents: null, fxRate: null });
  });
});
