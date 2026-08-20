import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { computeDashboard, clampedEquity, type DashboardAccount, type DashboardInput } from "@/lib/domain/dashboard";

const NOW = new Date("2026-07-28T12:00:00.000Z");

function account(overrides: Partial<DashboardAccount>): DashboardAccount {
  return {
    id: "acc-1",
    name: "Compte",
    type: "CHECKING",
    institutionId: null,
    institution: null,
    taxTreatment: "TAXABLE",
    taxRatePct: null,
    manualValueCents: null,
    liabilityCents: null,
    loanAmountCents: null,
    loanTaeg: null,
    loanDurationMonths: null,
    loanDeferralMonths: null,
    loanStartDate: null,
    holdings: [],
    history: [],
    ...overrides,
  };
}

function baseInput(overrides: Partial<DashboardInput>): DashboardInput {
  return {
    accounts: [],
    allBalances: [],
    intlLocale: "fr-FR",
    now: NOW,
    ...overrides,
  };
}

describe("clampedEquity", () => {
  it("returns value minus liability when positive", () => {
    expect(clampedEquity(BigInt(300_000_00), BigInt(200_000_00))).toBe(BigInt(100_000_00));
  });

  it("floors at 0 for an underwater property, instead of going negative", () => {
    expect(clampedEquity(BigInt(100_00), BigInt(150_00))).toBe(BigInt(0));
  });
});

describe("computeDashboard", () => {
  it("returns hasAccounts: false and zeroed totals for an empty portfolio", () => {
    const result = computeDashboard(baseInput({}));
    expect(result.hasAccounts).toBe(false);
    expect(result.netWorth).toBe(BigInt(0));
    expect(result.institutions).toEqual([]);
  });

  it("aggregates gross assets, liabilities, and net worth the same way as lib/analytics.ts's computeAnalytics", () => {
    const input = baseInput({
      accounts: [
        account({ id: "checking", history: [{ balanceCents: BigInt(500_00) }] }),
        account({
          id: "real-estate",
          type: "REAL_ESTATE",
          manualValueCents: BigInt(300_000_00),
          liabilityCents: BigInt(200_000_00),
        }),
        account({
          id: "loan",
          type: "LOAN",
          loanAmountCents: BigInt(50_000_00),
          loanTaeg: 3,
          loanDurationMonths: 240,
          loanDeferralMonths: 0,
          loanStartDate: new Date("2026-01-01T00:00:00.000Z"),
        }),
      ],
    });

    const result = computeDashboard(input);

    expect(result.hasAccounts).toBe(true);
    expect(result.grossAssets).toBe(BigInt(300_500_00));
    expect(result.totalLiabilities).toBeGreaterThan(BigInt(200_000_00));
    expect(result.totalLiabilities).toBeLessThan(BigInt(250_000_00));
    expect(result.netWorth).toBe(result.grossAssets - result.totalLiabilities - result.totalLatentTax);
  });

  it("floors real-estate/automobile equity in the allocation bucket instead of letting it go negative when underwater", () => {
    const result = computeDashboard(
      baseInput({
        accounts: [
          account({ type: "AUTOMOBILE", manualValueCents: BigInt(5_000_00), liabilityCents: BigInt(8_000_00) }),
        ],
      })
    );
    expect(result.allocationRaw.auto).toBe(0);
    // the excess liability still reduces net worth even though the allocation bucket floors at 0
    expect(result.totalLiabilities).toBe(BigInt(8_000_00));
  });

  it("taxes latent investment gains using the account's own tax rate, mirroring computeAnalytics", () => {
    const result = computeDashboard(
      baseInput({
        accounts: [
          account({
            type: "INVESTMENT",
            taxTreatment: "TAXABLE",
            taxRatePct: 0.3,
            holdings: [
              {
                quantity: new Decimal(10),
                lastPriceCents: BigInt(200_00),
                costBasisCents: BigInt(1000_00),
              },
            ],
          }),
        ],
      })
    );
    // value = 2000, gain = 1000, tax = 300
    expect(result.totalLatentTax).toBe(BigInt(300_00));
  });

  it("groups accounts by institution and sums their value, sorted by total descending", () => {
    const result = computeDashboard(
      baseInput({
        accounts: [
          account({
            id: "a1",
            institutionId: "inst-a",
            institution: { name: "Bank A", logoUrl: null },
            history: [{ balanceCents: BigInt(100_00) }],
          }),
          account({
            id: "b1",
            institutionId: "inst-b",
            institution: { name: "Bank B", logoUrl: null },
            history: [{ balanceCents: BigInt(900_00) }],
          }),
        ],
      })
    );
    expect(result.institutions).toHaveLength(2);
    expect(result.institutions[0].name).toBe("Bank B");
    expect(result.institutions[0].total).toBe(BigInt(900_00));
    expect(result.institutions[1].name).toBe("Bank A");
  });

  it("groups accounts with no institution under a single null-name bucket", () => {
    const result = computeDashboard(
      baseInput({
        accounts: [
          account({ id: "a1", history: [{ balanceCents: BigInt(100_00) }] }),
          account({ id: "a2", history: [{ balanceCents: BigInt(200_00) }] }),
        ],
      })
    );
    expect(result.institutions).toHaveLength(1);
    expect(result.institutions[0].name).toBeNull();
    expect(result.institutions[0].accounts).toHaveLength(2);
  });

  it("computes a running daily net worth from HistoricalBalance rows across accounts", () => {
    const result = computeDashboard(
      baseInput({
        accounts: [account({ id: "a1" })],
        allBalances: [
          { accountId: "a1", recordedAt: new Date("2026-07-01T00:00:00.000Z"), balanceCents: BigInt(1000_00) },
          { accountId: "a1", recordedAt: new Date("2026-07-15T00:00:00.000Z"), balanceCents: BigInt(1200_00) },
        ],
      })
    );
    expect(result.history).toHaveLength(2);
    expect(result.history[0].netWorth).toBe(1000_00);
    expect(result.history[1].netWorth).toBe(1200_00);
    // isoDate (app/api/v1/net-worth/history/route.ts's data source) must
    // stay a real "YYYY-MM-DD" derived from the same day the formatted
    // `date` string represents - not a separate lookup that could drift.
    expect(result.history[0].isoDate).toBe("2026-07-01");
    expect(result.history[1].isoDate).toBe("2026-07-15");
  });

  it("computes delta30 against the closest day at or before 30 days ago", () => {
    const result = computeDashboard(
      baseInput({
        accounts: [account({ id: "a1" })],
        allBalances: [
          { accountId: "a1", recordedAt: new Date("2026-06-01T00:00:00.000Z"), balanceCents: BigInt(1000_00) },
          { accountId: "a1", recordedAt: NOW, balanceCents: BigInt(1300_00) },
        ],
      })
    );
    expect(result.delta30).not.toBeNull();
    expect(result.delta30!.amount).toBe(300_00);
    expect(result.delta30!.percent).toBeCloseTo(30, 5);
  });

  it("returns delta30: null when there's fewer than two days of history", () => {
    const result = computeDashboard(
      baseInput({
        accounts: [account({ id: "a1" })],
        allBalances: [{ accountId: "a1", recordedAt: NOW, balanceCents: BigInt(1000_00) }],
      })
    );
    expect(result.delta30).toBeNull();
  });
});
