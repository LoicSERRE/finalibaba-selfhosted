/**
 * Pure aggregation for the Analytics "Full sector-exposure breakdown"
 * section (v1.16) - no I/O, no fetch. Fetching/resolving per-holding sector
 * data lives in lib/services/yahoo-finance.ts and
 * lib/services/sector-fallback-providers.ts; this file only combines
 * already-resolved SectorWeights into a portfolio-wide breakdown. See
 * CLAUDE.md's "Full sector-exposure breakdown" for the full design and the
 * real scoping research (why Yahoo + two optional fallback providers,
 * instead of one hardcoded source) behind this feature.
 */

// 0-1 fractions, keyed by the canonical sector keys below. A resolved ETF's
// weights sum to ~1 (Yahoo/FMP/Alpha Vantage all report the fully-invested
// portion); a resolved individual stock has exactly one key at 1.
export type SectorWeights = Record<string, number>;

// The 11 canonical GICS-style sector keys this app buckets into - matches
// Yahoo Finance's own topHoldings.sectorWeightings key set (confirmed live
// against real ETF data during scoping), used as the single internal
// taxonomy every data source (Yahoo search, Yahoo topHoldings, FMP, Alpha
// Vantage) gets normalized into. Two more keys exist outside this list and
// outside normalizeSectorKey's domain entirely, both assigned directly by
// the caller (app/analytics/page.tsx) rather than resolved from any source:
// "crypto" (CRYPTO-account holdings - BTC/ETH-style tickers have no GICS
// sector, so classifying them as one of these 11 would be a real inaccuracy,
// not a data gap) and "unclassified" (aggregateSectorExposure's own fallback
// for a genuinely unresolved holding).
export const SECTOR_KEYS = [
  "technology",
  "financial_services",
  "healthcare",
  "consumer_cyclical",
  "consumer_defensive",
  "industrials",
  "energy",
  "utilities",
  "basic_materials",
  "real_estate",
  "communication_services",
] as const;

export type SectorKey = (typeof SECTOR_KEYS)[number];

/**
 * Normalizes a raw sector label from Yahoo Finance into one of SECTOR_KEYS.
 * Yahoo itself uses two different casings for the same 11 sectors depending
 * on the endpoint - confirmed live during scoping, not guessed:
 * `/v1/finance/search`'s per-stock `sector` field is Title Case with spaces
 * ("Consumer Cyclical"), while `quoteSummary`'s `topHoldings.sectorWeightings`
 * keys are already snake_case ("consumer_cyclical"). Lowercasing + replacing
 * spaces with underscores unifies both - except one real quirk found live:
 * topHoldings' real-estate key is the unbroken word `realestate`, not
 * `real_estate`, while search's stock sector string ("Real Estate") would
 * naturally normalize to `real_estate` - handled as an explicit special
 * case below rather than silently producing two different keys for the same
 * sector.
 */
export function normalizeSectorKey(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, "_");
  return key === "realestate" ? "real_estate" : key;
}

export interface SectorExposureHolding {
  marketValueCents: bigint;
  // null = this holding's sector couldn't be resolved from any source
  // (Yahoo, and neither optional fallback provider if configured/reachable) -
  // contributes to unclassifiedCents rather than being silently dropped, so
  // the breakdown always accounts for the portfolio's full invested value.
  sectorWeights: SectorWeights | null;
}

export interface SectorExposureResult {
  // Only keys that actually received weight from at least one holding are
  // present - callers render whatever's here, they don't need to know the
  // full SECTOR_KEYS list to iterate correctly.
  breakdown: Record<string, bigint>;
  unclassifiedCents: bigint;
  totalCents: bigint;
}

/**
 * Weighted sum of each holding's market value across its resolved sector
 * weights - a holding split 60/40 across two sectors contributes 60%/40% of
 * its own market value to each, not its whole value to both.
 */
export function aggregateSectorExposure(holdings: SectorExposureHolding[]): SectorExposureResult {
  const breakdown: Record<string, bigint> = {};
  let unclassifiedCents = BigInt(0);
  let totalCents = BigInt(0);

  for (const h of holdings) {
    totalCents += h.marketValueCents;

    if (!h.sectorWeights || Object.keys(h.sectorWeights).length === 0) {
      unclassifiedCents += h.marketValueCents;
      continue;
    }

    for (const [rawKey, weight] of Object.entries(h.sectorWeights)) {
      if (weight <= 0) continue;
      const key = normalizeSectorKey(rawKey);
      const cents = BigInt(Math.round(Number(h.marketValueCents) * weight));
      breakdown[key] = (breakdown[key] ?? BigInt(0)) + cents;
    }
  }

  return { breakdown, unclassifiedCents, totalCents };
}
