import Decimal from "decimal.js";
import type { AnalyticsInput } from "@/lib/domain/analytics";

/**
 * The deliberately awkward portfolio the characterization tests pin their
 * output against: every account type, a loan mid-amortisation, a holding with
 * no cost basis, a property with a mortgage, goals linked and unlinked, and a
 * gappy balance history. Shared so the analytics computation and the export
 * built from it are pinned against the same data. Not a *.test.ts file, so
 * vitest never runs it on its own.
 */

export const NOW = new Date("2026-07-28T12:00:00.000Z");

export function day(d: string) {
  return new Date(`${d}T12:00:00.000Z`);
}

export const HOLDINGS = [
  // Cost basis known, a real gain, and a rebalancing target set.
  { ticker: "IE00B4L5Y983", name: "iShares Core MSCI World", quantity: new Decimal("12.5"), lastPriceCents: BigInt(9_876), costBasisCents: BigInt(100_000) },
  // No cost basis at all: contributes value but must not invent a gain.
  { ticker: "FR0010315770", name: "Lyxor PEA Monde", quantity: new Decimal("40"), lastPriceCents: BigInt(2_501), costBasisCents: null },
  // A loss, so the gain-weighted tax blend has both signs to deal with.
  { ticker: "US0378331005", name: "Apple", quantity: new Decimal("3"), lastPriceCents: BigInt(15_000), costBasisCents: BigInt(60_000) },
];

export const ACCOUNTS: AnalyticsInput["accounts"] = [
  {
    id: "cur", name: "Courant", type: "CHECKING", investmentSubtype: null,
    investmentStartDate: null, taxTreatment: "EXEMPT", taxRatePct: null,
    dividendsAlreadyNet: false, interestRatePct: null, manualValueCents: null,
    liabilityCents: null, syncId: "lcl:1", loanAmountCents: null, loanTaeg: null,
    loanDurationMonths: null, loanDeferralMonths: null, loanStartDate: null,
    institution: { name: "LCL" }, holdings: [], history: [{ balanceCents: BigInt(2_345_67) }],
  },
  {
    id: "liv", name: "Livret A", type: "SAVINGS", investmentSubtype: null,
    investmentStartDate: null, taxTreatment: "EXEMPT", taxRatePct: null,
    dividendsAlreadyNet: false, interestRatePct: 0.017, manualValueCents: null,
    liabilityCents: null, syncId: null, loanAmountCents: null, loanTaeg: null,
    loanDurationMonths: null, loanDeferralMonths: null, loanStartDate: null,
    institution: { name: "LCL" }, holdings: [], history: [{ balanceCents: BigInt(15_000_00) }],
  },
  {
    // Interest-bearing with NO rate set: must count as unknown, not as zero.
    id: "lep", name: "LEP", type: "SAVINGS", investmentSubtype: null,
    investmentStartDate: null, taxTreatment: "EXEMPT", taxRatePct: null,
    dividendsAlreadyNet: false, interestRatePct: null, manualValueCents: null,
    liabilityCents: null, syncId: null, loanAmountCents: null, loanTaeg: null,
    loanDurationMonths: null, loanDeferralMonths: null, loanStartDate: null,
    institution: { name: "LCL" }, holdings: [], history: [{ balanceCents: BigInt(3_000_00) }],
  },
  {
    id: "pea", name: "PEA", type: "INVESTMENT", investmentSubtype: "PEA",
    investmentStartDate: day("2021-03-15"), taxTreatment: "TAXABLE", taxRatePct: 0.186,
    dividendsAlreadyNet: false, interestRatePct: null, manualValueCents: null,
    liabilityCents: null, syncId: null, loanAmountCents: null, loanTaeg: null,
    loanDurationMonths: null, loanDeferralMonths: null, loanStartDate: null,
    institution: { name: "Bourso" }, holdings: HOLDINGS.slice(0, 2), history: [],
  },
  {
    id: "cto", name: "CTO", type: "INVESTMENT", investmentSubtype: "CTO",
    investmentStartDate: day("2024-01-01"), taxTreatment: "TAXABLE", taxRatePct: 0.314,
    dividendsAlreadyNet: false, interestRatePct: null, manualValueCents: null,
    liabilityCents: null, syncId: null, loanAmountCents: null, loanTaeg: null,
    loanDurationMonths: null, loanDeferralMonths: null, loanStartDate: null,
    institution: { name: "Trade Republic" }, holdings: [HOLDINGS[2]], history: [],
  },
  {
    id: "cry", name: "Crypto", type: "CRYPTO", investmentSubtype: null,
    investmentStartDate: day("2023-06-01"), taxTreatment: "TAXABLE", taxRatePct: 0.314,
    dividendsAlreadyNet: false, interestRatePct: null, manualValueCents: null,
    liabilityCents: null, syncId: null, loanAmountCents: null, loanTaeg: null,
    loanDurationMonths: null, loanDeferralMonths: null, loanStartDate: null,
    institution: null,
    holdings: [{ ticker: "BTC", name: "Bitcoin", quantity: new Decimal("0.15"), lastPriceCents: BigInt(6_000_000), costBasisCents: BigInt(500_000) }],
    history: [],
  },
  {
    id: "app", name: "Appartement", type: "REAL_ESTATE", investmentSubtype: null,
    investmentStartDate: null, taxTreatment: "EXEMPT", taxRatePct: null,
    dividendsAlreadyNet: false, interestRatePct: null,
    manualValueCents: BigInt(300_000_00), liabilityCents: BigInt(180_000_00),
    syncId: null, loanAmountCents: null, loanTaeg: null, loanDurationMonths: null,
    loanDeferralMonths: null, loanStartDate: null, institution: null, holdings: [], history: [],
  },
  {
    id: "car", name: "Voiture", type: "AUTOMOBILE", investmentSubtype: null,
    investmentStartDate: null, taxTreatment: "EXEMPT", taxRatePct: null,
    dividendsAlreadyNet: false, interestRatePct: null,
    manualValueCents: BigInt(9_500_00), liabilityCents: BigInt(0),
    syncId: null, loanAmountCents: null, loanTaeg: null, loanDurationMonths: null,
    loanDeferralMonths: null, loanStartDate: null, institution: null, holdings: [], history: [],
  },
  {
    id: "loan", name: "Prêt immo", type: "LOAN", investmentSubtype: null,
    investmentStartDate: null, taxTreatment: "EXEMPT", taxRatePct: null,
    dividendsAlreadyNet: false, interestRatePct: null, manualValueCents: null,
    liabilityCents: null, syncId: null,
    loanAmountCents: BigInt(200_000_00), loanTaeg: 1.9, loanDurationMonths: 240,
    loanDeferralMonths: 0, loanStartDate: day("2021-01-01"),
    institution: { name: "LCL" }, holdings: [], history: [],
  },
];

/** Deliberately gappy: two accounts, uneven days, not every account every day. */
export const BALANCES: AnalyticsInput["allBalances"] = [
  { accountId: "cur", recordedAt: day("2026-05-01"), balanceCents: BigInt(2_000_00) },
  { accountId: "liv", recordedAt: day("2026-05-01"), balanceCents: BigInt(14_000_00) },
  { accountId: "cur", recordedAt: day("2026-06-15"), balanceCents: BigInt(2_500_00) },
  { accountId: "liv", recordedAt: day("2026-07-01"), balanceCents: BigInt(15_000_00) },
  { accountId: "cur", recordedAt: day("2026-07-20"), balanceCents: BigInt(2_345_67) },
];

export const INPUT: AnalyticsInput = {
  accounts: ACCOUNTS,
  allBalances: BALANCES,
  settings: {
    salaryNetCents: BigInt(3_200_00),
    monthlyExpensesCents: BigInt(1_850_00),
    monthlySavedCents: BigInt(900_00),
    taxRatePea: 0.186,
    taxRateCto: 0.314,
  },
  goals: [
    { id: "g1", name: "Patrimoine", targetCents: BigInt(500_000_00), targetDate: null, accountId: null },
    { id: "g2", name: "Fonds d'urgence", targetCents: BigInt(20_000_00), targetDate: day("2027-01-01"), accountId: "liv" },
  ],
  yfData: {},
  incomeEventsYtd: [
    { type: "DIVIDEND", amountCents: BigInt(146), taxWithheldCents: BigInt(22) },
    { type: "INTEREST", amountCents: BigInt(87_50), taxWithheldCents: null },
  ],
  msciWorldHistory: [
    { date: day("2021-01-01"), close: 80 },
    { date: day("2024-01-01"), close: 100 },
    { date: day("2026-07-28"), close: 131.5 },
  ],
  sp500History: [
    { date: day("2021-01-01"), close: 3700 },
    { date: day("2026-07-28"), close: 5600 },
  ],
  cac40History: [],
  intlLocale: "fr-FR",
  now: NOW,
};

/** BigInt and Decimal do not survive JSON; render them as their own digits. */
export function stable(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === "bigint") return `${v}n`;
      if (v instanceof Decimal) return v.toString();
      return v;
    })
  );
}

/**
 * The same portfolio with market data attached, so the dividend calendar and
 * the CAC 40 benchmark - both empty above - carry real rows. The CTO gains
 * three dividend payers whose ex-dates land in every bucket the calendar
 * distinguishes: past, within 30 days, later, and unknown (no Yahoo data).
 */
export const INPUT_WITH_MARKET_DATA: AnalyticsInput = {
  ...INPUT,
  accounts: ACCOUNTS.map((a) =>
    a.id === "cto"
      ? {
          ...a,
          holdings: [
            ...a.holdings,
            // Air Liquide: no Yahoo data at all, falls back to the static yield.
            { ticker: "FR0000120073", name: "Air Liquide", quantity: new Decimal("7"), lastPriceCents: BigInt(17_850), costBasisCents: BigInt(110_000) },
            // Ferrari: ex-dividend date already passed.
            { ticker: "NL0011585146", name: "Ferrari", quantity: new Decimal("2"), lastPriceCents: BigInt(41_200), costBasisCents: BigInt(70_000) },
            // Meta: ex-dividend date far in the future.
            { ticker: "US30303M1027", name: "Meta", quantity: new Decimal("1.5"), lastPriceCents: BigInt(52_000), costBasisCents: BigInt(65_000) },
          ],
        }
      : a
  ),
  yfData: {
    AAPL: { exDividendDate: day("2026-08-10"), annualYield: 0.0044, annualRatePerShare: 1.04 },
    RACE: { exDividendDate: day("2026-04-22"), annualYield: 0.0071, annualRatePerShare: 2.986 },
    META: { exDividendDate: day("2026-12-14"), annualYield: 0.0039, annualRatePerShare: 2.1 },
  },
  cac40History: [
    { date: day("2021-01-01"), close: 5550 },
    { date: day("2026-07-28"), close: 7420 },
  ],
};
