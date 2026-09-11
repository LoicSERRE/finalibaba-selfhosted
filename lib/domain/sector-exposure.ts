/**
 * Pure aggregation for the sector-exposure breakdown - no I/O. Resolving a
 * holding's sectors lives in the two service modules; this only combines
 * already-resolved weights into a portfolio-wide picture.
 */

// 0-1 fractions, keyed by the canonical sector keys below. A resolved ETF's
// weights sum to ~1 (Yahoo/FMP/Alpha Vantage all report the fully-invested
// portion); a resolved individual stock has exactly one key at 1.
export type SectorWeights = Record<string, number>;

// The 11 GICS-style keys, matching Yahoo's own sectorWeightings set - the one
// internal taxonomy every source normalises into. Two more keys live OUTSIDE
// this list and outside normalizeSectorKey, assigned by the caller: "crypto"
// (no GICS sector exists, so bucketing it into one of these 11 would be an
// inaccuracy rather than a gap) and "unclassified".
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
 * A raw Yahoo sector label into one of SECTOR_KEYS. Yahoo uses two casings for
 * the same 11 sectors depending on the endpoint - Title Case from search,
 * snake_case from topHoldings - which lowercase-and-underscore unifies. One
 * real quirk needs an explicit case: topHoldings spells real estate
 * `realestate`, unbroken, so the generic rule would produce two different keys
 * for one sector.
 */
export function normalizeSectorKey(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, "_");
  return key === "realestate" ? "real_estate" : key;
}

export interface SectorExposureHolding {
  // Display label for this holding, already resolved by the caller (e.g.
  // "iShares Core MSCI World (PEA)") - kept as a plain string rather than
  // separate name/account fields so this file stays presentation-agnostic
  // about how the two are combined; app/analytics/page.tsx builds it once
  // from Holding.name/ticker + the parent Account.name.
  name: string;
  marketValueCents: bigint;
  // null = this holding's sector couldn't be resolved from any source
  // (Yahoo, and neither optional fallback provider if configured/reachable) -
  // contributes to unclassifiedCents rather than being silently dropped, so
  // the breakdown always accounts for the portfolio's full invested value.
  sectorWeights: SectorWeights | null;
}

export interface SectorContribution {
  name: string;
  cents: bigint;
}

// Real user request: "où ça vient" for a sector - which holdings actually
// make up its percentage, not just the total. Capped and sorted so a
// portfolio with many holdings still produces a short, scannable tooltip -
// same "safety cap, not a feature limit" precedent as MAX_UNCATEGORIZED_GROUPS
// (lib/domain/budgets.ts) / topAssets' own top-10 slice.
export const MAX_CONTRIBUTIONS_PER_SECTOR = 5;

export interface SectorExposureResult {
  // Only keys that actually received weight from at least one holding are
  // present - callers render whatever's here, they don't need to know the
  // full SECTOR_KEYS list to iterate correctly.
  breakdown: Record<string, bigint>;
  // Same keys as `breakdown` (plus "unclassified" when applicable) - each
  // list is sorted by contribution descending and capped at
  // MAX_CONTRIBUTIONS_PER_SECTOR; `truncated` says whether real contributors
  // beyond the cap exist, so the UI can show "+N autres" instead of
  // silently presenting a partial list as if it were the whole story.
  contributions: Record<string, { holdings: SectorContribution[]; truncated: boolean }>;
  unclassifiedCents: bigint;
  totalCents: bigint;
}

/**
 * Weighted sum of each holding's market value across its resolved sector
 * weights - a holding split 60/40 across two sectors contributes 60%/40% of
 * its own market value to each, not its whole value to both. Also builds
 * the per-sector contribution lists (see SectorContribution above).
 */
export function aggregateSectorExposure(holdings: SectorExposureHolding[]): SectorExposureResult {
  const breakdown: Record<string, bigint> = {};
  const contributionsByKey: Record<string, SectorContribution[]> = {};
  let unclassifiedCents = BigInt(0);
  let totalCents = BigInt(0);

  const addContribution = (key: string, name: string, cents: bigint) => {
    if (!contributionsByKey[key]) contributionsByKey[key] = [];
    contributionsByKey[key].push({ name, cents });
  };

  for (const h of holdings) {
    totalCents += h.marketValueCents;

    if (!h.sectorWeights || Object.keys(h.sectorWeights).length === 0) {
      unclassifiedCents += h.marketValueCents;
      addContribution("unclassified", h.name, h.marketValueCents);
      continue;
    }

    for (const [rawKey, weight] of Object.entries(h.sectorWeights)) {
      if (weight <= 0) continue;
      const key = normalizeSectorKey(rawKey);
      const cents = BigInt(Math.round(Number(h.marketValueCents) * weight));
      breakdown[key] = (breakdown[key] ?? BigInt(0)) + cents;
      addContribution(key, h.name, cents);
    }
  }

  const contributions: SectorExposureResult["contributions"] = {};
  for (const [key, list] of Object.entries(contributionsByKey)) {
    const sorted = [...list].sort((a, b) => Number(b.cents - a.cents));
    contributions[key] = {
      holdings: sorted.slice(0, MAX_CONTRIBUTIONS_PER_SECTOR),
      truncated: sorted.length > MAX_CONTRIBUTIONS_PER_SECTOR,
    };
  }

  return { breakdown, contributions, unclassifiedCents, totalCents };
}
