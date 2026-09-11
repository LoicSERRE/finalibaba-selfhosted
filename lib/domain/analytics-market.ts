/**
 * Static market reference data and the small pure helpers over it, split out
 * of analytics.ts when that file passed 1100 lines and a fourth audit in a row
 * flagged it. No aggregation here: this is what the estimate reads FROM.
 */
import Decimal from "decimal.js";
import { FR_PFU_TOTAL_RATE, FR_SOCIAL_LEVIES_RATE } from "@/lib/domain/tax-locale";

// ── Static config ────────────────────────────────────────────────────────────

// Annual dividend yields (only distributing stocks; accumulating ETFs = 0)
export const DIVIDEND_YIELDS: Record<string, number> = {
  FR0000120073: 0.020, // Air Liquide ~2%
  NL0011585146: 0.005, // Ferrari ~0.5%
  US0378331005: 0.005, // Apple ~0.5%
  US30303M1027: 0.004, // Meta ~0.4%
  US5801351017: 0.025, // McDonald's ~2.5%
  US5949181045: 0.008, // Microsoft ~0.8%
};

// Yahoo Finance ticker symbols for dividend-paying holdings
export const ISIN_TO_YF_SYMBOL: Record<string, string> = {
  FR0000120073: "AI.PA",
  NL0011585146: "RACE",
  US0378331005: "AAPL",
  US30303M1027: "META",
  US5801351017: "MCD",
  US5949181045: "MSFT",
};

// Reference indices for the benchmark comparison. URTH (iShares MSCI World
// ETF) is the standard free proxy for the MSCI World index itself - Yahoo
// has no clean "^" ticker for it, unlike S&P 500/CAC 40.
export const BENCHMARK_SYMBOLS = {
  msciWorld: "URTH",
  sp500: "^GSPC",
  cac40: "^FCHI",
} as const;

// ── Types shared with lib/yahoo-finance.ts (fetch layer) ─────────────────────

export type YFDividendInfo = {
  exDividendDate: Date | null;
  annualYield: number | null;        // trailingAnnualDividendYield (ex: 0.025 = 2.5%) - currency-agnostic
  annualRatePerShare: number | null; // trailingAnnualDividendRate in local currency (display only)
};

export type PricePoint = { date: Date; close: number };

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function holdingMarketValue(h: { quantity: Decimal; lastPriceCents: bigint }): bigint {
  return BigInt(
    new Decimal(h.quantity.toString())
      .mul(h.lastPriceCents.toString())
      .round()
      .toNumber()
  );
}

// Effective dividend tax rate for a French tax resident under the flat tax (PFU) regime.
// PEA: reinvested within the wrapper - no immediate tax.
// CTO French equities: flat tax, FR_PFU_TOTAL_RATE (income tax + social levies - see tax-locale.ts).
// CTO foreign equities (15% treaty): 15% withholding + the social-levies half only
//   → tax credit offsets the income-tax half (15% withholding > 12.8% IR → IR = 0).
// Note: estimate under flat-tax assumption. Actual net may differ with progressive scale or 40% deduction.
export function dividendEffectiveTaxRate(isin: string, subtype: string | null): number {
  if (subtype === "PEA") return 0;
  const country = isin.slice(0, 2).toUpperCase();
  if (country === "FR") return FR_PFU_TOTAL_RATE;
  // Countries with a 15% withholding treaty with France (US, NL, IE, DE, GB, LU, BE...)
  const treaty15 = ["US", "NL", "IE", "DE", "GB", "LU", "BE", "CA", "JP", "CH"];
  if (treaty15.includes(country)) return 0.15 + FR_SOCIAL_LEVIES_RATE;
  return FR_PFU_TOTAL_RATE; // default: flat tax, no known withholding treaty
}

/** Closest data point to `target`, or null if the series is empty. */
export function priceAt(series: PricePoint[], target: Date): PricePoint | null {
  if (series.length === 0) return null;
  let closest = series[0];
  let minDiffMs = Math.abs(series[0].date.getTime() - target.getTime());
  for (const p of series) {
    const diffMs = Math.abs(p.date.getTime() - target.getTime());
    if (diffMs < minDiffMs) {
      minDiffMs = diffMs;
      closest = p;
    }
  }
  return closest;
}

/**
 * Same CAGR(r) = (end/start)^(1/years) − 1 formula used for investCAGR.
 * Years is derived from the *actual* matched start point, not the requested
 * startDate - if the fetched series doesn't reach back that far (shouldn't
 * happen with range=max, but degrades safely if Yahoo returns less), this
 * keeps the exponent consistent with the prices actually being compared
 * instead of silently understating the CAGR.
 */
export function computeIndexCAGR(series: PricePoint[], startDate: Date, now: Date): number | null {
  const startPoint = priceAt(series, startDate);
  const endPoint = priceAt(series, now);
  if (startPoint === null || endPoint === null || startPoint.close <= 0) return null;

  const years = (endPoint.date.getTime() - startPoint.date.getTime()) / (365.25 * 86_400_000);
  if (years < 1 / 12) return null;

  return (Math.pow(endPoint.close / startPoint.close, 1 / years) - 1) * 100;
}
