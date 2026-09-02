// Reuses the same unauthenticated Yahoo Finance chart endpoint/headers/
// caching convention already established in app/analytics/page.tsx
// (fetchYFDividendForSymbol/fetchYFPriceHistory) - extracted here, not kept
// page-local, since this is the first Yahoo fetch needed from a Server
// Action (lib/actions/holdings.ts) rather than a page.

const CURRENCY_PAIR_SYMBOLS: Record<"USD" | "GBP" | "CHF", string> = {
  USD: "EURUSD=X",
  GBP: "EURGBP=X",
  CHF: "EURCHF=X",
};

/**
 * EUR per 1 unit of `currency` (e.g. ~0.92 for USD), or null on failure.
 * Yahoo's EURxxx=X pairs quote "xxx per 1 EUR", so the raw price is inverted.
 *
 * `bypassCache` skips the 1h `next.revalidate` window - used by the
 * on-demand "refresh" action (lib/actions/holdings.ts's
 * refreshHoldingExchangeRate) so a user who explicitly asks for a fresh
 * rate minutes after the last fetch actually gets one, instead of silently
 * getting back the same cached value with no way to tell. upsertHolding's
 * own entry-time fetch keeps the cached path - there's no "on demand"
 * expectation there, and reusing the cache avoids extra Yahoo requests for
 * that hot path.
 */
import { fetchExternal } from "@/lib/services/external-fetch";

export async function fetchExchangeRateToEur(
  currency: "USD" | "GBP" | "CHF",
  bypassCache = false
): Promise<number | null> {
  try {
    const symbol = CURRENCY_PAIR_SYMBOLS[currency];
    const res = await fetchExternal(
      `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`,
      {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
        ...(bypassCache ? { cache: "no-store" as const } : { next: { revalidate: 3600 } }),
      }
    );
    if (!res.ok) return null;

    const data = await res.json();
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice as number | undefined;
    if (!price || price <= 0) return null;

    return 1 / price;
  } catch {
    return null;
  }
}
