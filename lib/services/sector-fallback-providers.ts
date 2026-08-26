import type { SectorWeights } from "@/lib/domain/sector-exposure";
import { normalizeSectorKey } from "@/lib/domain/sector-exposure";

/**
 * Two optional, deploy-time fallback providers for ETF sector weightings,
 * used only when Yahoo Finance's own crumb-gated quoteSummary path fails
 * (lib/services/yahoo-finance.ts's resolveHoldingSectorWeights/
 * probeYahooSectorHealth) - see CLAUDE.md's "Full sector-exposure breakdown"
 * for the full scoping writeup behind picking these two specifically.
 *
 * Both are real, documented, API-key-authenticated REST APIs (not scraping
 * workarounds like Yahoo's crumb mechanism) - `FMP_API_KEY` and
 * `ALPHA_VANTAGE_API_KEY` are optional `.env` variables, same category as
 * `GOCARDLESS_SECRET_ID`/`GOCARDLESS_SECRET_KEY` (a third-party credential a
 * self-hoster can configure for extra resilience, never required for setup).
 *
 * Honesty note, not glossed over: neither provider's response shape could be
 * confirmed end-to-end against an arbitrary real ISIN in the session this was
 * built in (no registered API key was available). Alpha Vantage's public
 * `demo` key did confirm the real, correctly-shaped response for its own
 * canned example symbol (QQQ) - see fetchAlphaVantageEtfSectorWeights below.
 * FMP's shape is implemented against its public documentation only (its own
 * docs site returned a 403 to a direct fetch attempt during scoping).
 * Whoever configures either key first should sanity-check the Analytics
 * page's sector section actually shows data for their own holdings.
 */

async function fetchFmpEtfSectorWeightings(symbol: string): Promise<SectorWeights | null> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(
      `https://financialmodelingprep.com/api/v3/etf-sector-weightings/${encodeURIComponent(symbol)}?apikey=${encodeURIComponent(apiKey)}`,
      { headers: { Accept: "application/json" }, next: { revalidate: 3600 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const weights: SectorWeights = {};
    for (const entry of data) {
      const sector = entry?.sector as string | undefined;
      // FMP documents weightPercentage as a string like "45.20%" - parseFloat
      // stops at the first non-numeric character, so the trailing "%" is
      // safely ignored without a separate strip step.
      const pct = Number.parseFloat(entry?.weightPercentage);
      if (sector && Number.isFinite(pct) && pct > 0) {
        weights[normalizeSectorKey(sector)] = pct / 100;
      }
    }
    return Object.keys(weights).length > 0 ? weights : null;
  } catch {
    return null;
  }
}

// Alpha Vantage's ETF_PROFILE uses official GICS sector names, which don't
// share Yahoo's own casing/wording convention - confirmed live via the
// public `demo` key against QQQ (a real response, not documentation-only):
// "INFORMATION TECHNOLOGY", "CONSUMER DISCRETIONARY", "CONSUMER STAPLES",
// "FINANCIALS", "MATERIALS" name the same 4 sectors Yahoo calls
// "Technology"/"Consumer Cyclical"/"Consumer Defensive"/"Financial
// Services"/"Basic Materials" - normalizeSectorKey's generic
// lowercase-and-underscore alone would produce a different, non-matching key
// for each of these, so they're aliased explicitly here rather than merged
// by guesswork. The remaining sectors ("Communication Services",
// "Industrials", "Utilities", "Energy", "Real Estate", "Healthcare") already
// match Yahoo's own wording once normalized, so they don't need an entry.
const ALPHA_VANTAGE_SECTOR_ALIASES: Record<string, string> = {
  "information technology": "technology",
  "consumer discretionary": "consumer_cyclical",
  "consumer staples": "consumer_defensive",
  financials: "financial_services",
  materials: "basic_materials",
};

function normalizeAlphaVantageSector(raw: string): string {
  const lowered = raw.trim().toLowerCase();
  return ALPHA_VANTAGE_SECTOR_ALIASES[lowered] ?? normalizeSectorKey(raw);
}

async function fetchAlphaVantageEtfSectorWeightings(symbol: string): Promise<SectorWeights | null> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(
      `https://www.alphavantage.co/query?function=ETF_PROFILE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`,
      { headers: { Accept: "application/json" }, next: { revalidate: 3600 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const sectors = data?.sectors as { sector?: string; weight?: string }[] | undefined;
    if (!sectors || sectors.length === 0) return null;

    const weights: SectorWeights = {};
    for (const entry of sectors) {
      const weight = Number.parseFloat(entry.weight ?? "");
      if (entry.sector && Number.isFinite(weight) && weight > 0) {
        weights[normalizeAlphaVantageSector(entry.sector)] = weight;
      }
    }
    return Object.keys(weights).length > 0 ? weights : null;
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
