import type { SectorWeights } from "@/lib/domain/sector-exposure";
import { normalizeSectorKey } from "@/lib/domain/sector-exposure";

/**
 * Two optional fallbacks for ETF sector weightings, tried only when Yahoo's
 * crumb-gated path fails. Both are documented, key-authenticated REST APIs
 * rather than scraping workarounds; both keys are optional .env variables.
 *
 * **Unverified end to end.** Alpha Vantage's shape was confirmed live via its
 * public demo key on QQQ; FMP's is implemented from documentation alone.
 * Whoever configures a key first should check the sector section actually
 * shows data for their own holdings.
 */

/**
 * Pure parsing, split from the fetch so it is testable without mocking network
 * I/O. Asserts the DOCUMENTED shape, not a live response - see the top of the
 * file.
 */
import { fetchExternal } from "@/lib/services/external-fetch";

export function parseFmpSectorWeightings(data: unknown): SectorWeights | null {
  if (!Array.isArray(data) || data.length === 0) return null;

  const weights: SectorWeights = {};
  for (const entry of data as { sector?: string; weightPercentage?: string }[]) {
    const sector = entry?.sector;
    // FMP documents weightPercentage as a string like "45.20%" - parseFloat
    // stops at the first non-numeric character, so the trailing "%" is
    // safely ignored without a separate strip step.
    const pct = Number.parseFloat(entry?.weightPercentage ?? "");
    if (sector && Number.isFinite(pct) && pct > 0) {
      weights[normalizeSectorKey(sector)] = pct / 100;
    }
  }
  return Object.keys(weights).length > 0 ? weights : null;
}

async function fetchFmpEtfSectorWeightings(symbol: string): Promise<SectorWeights | null> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetchExternal(
      `https://financialmodelingprep.com/api/v3/etf-sector-weightings/${encodeURIComponent(symbol)}?apikey=${encodeURIComponent(apiKey)}`,
      { headers: { Accept: "application/json" }, next: { revalidate: 3600 } }
    );
    if (!res.ok) return null;
    return parseFmpSectorWeightings(await res.json());
  } catch {
    return null;
  }
}

// Alpha Vantage uses official GICS names where Yahoo uses its own wording, so
// the generic normaliser produces a non-matching key for these five. Aliased
// explicitly rather than merged by guesswork; every other sector already
// matches Yahoo once normalised.
const ALPHA_VANTAGE_SECTOR_ALIASES: Record<string, string> = {
  "information technology": "technology",
  "consumer discretionary": "consumer_cyclical",
  "consumer staples": "consumer_defensive",
  financials: "financial_services",
  materials: "basic_materials",
};

export function normalizeAlphaVantageSector(raw: string): string {
  const lowered = raw.trim().toLowerCase();
  return ALPHA_VANTAGE_SECTOR_ALIASES[lowered] ?? normalizeSectorKey(raw);
}

/**
 * Pure response-shape parsing, extracted for the same testability reason as
 * parseFmpSectorWeightings above - unlike FMP's shape, this one is asserted
 * against a real, live-confirmed response (Alpha Vantage's public `demo` key
 * against QQQ, see the top-of-file comment), not documentation alone.
 */
export function parseAlphaVantageSectorWeightings(data: unknown): SectorWeights | null {
  const sectors = (data as { sectors?: { sector?: string; weight?: string }[] } | undefined)
    ?.sectors;
  if (!sectors || sectors.length === 0) return null;

  const weights: SectorWeights = {};
  for (const entry of sectors) {
    const weight = Number.parseFloat(entry.weight ?? "");
    if (entry.sector && Number.isFinite(weight) && weight > 0) {
      weights[normalizeAlphaVantageSector(entry.sector)] = weight;
    }
  }
  return Object.keys(weights).length > 0 ? weights : null;
}

async function fetchAlphaVantageEtfSectorWeightings(symbol: string): Promise<SectorWeights | null> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetchExternal(
      `https://www.alphavantage.co/query?function=ETF_PROFILE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`,
      { headers: { Accept: "application/json" }, next: { revalidate: 3600 } }
    );
    if (!res.ok) return null;
    return parseAlphaVantageSectorWeightings(await res.json());
  } catch {
    return null;
  }
}

/**
 * Tries FMP then Alpha Vantage, in order - first one that's configured
 * (API key present) and actually returns data wins. Returns null when
 * neither is configured, or both are configured but both failed - the
 * caller (resolveHoldingSectorWeights/probeYahooSectorHealth) treats that
 * identically to "no fallback available at all".
 */
export async function fetchFallbackEtfSectorWeights(symbol: string): Promise<SectorWeights | null> {
  const fromFmp = await fetchFmpEtfSectorWeightings(symbol);
  if (fromFmp) return fromFmp;
  return fetchAlphaVantageEtfSectorWeightings(symbol);
}
