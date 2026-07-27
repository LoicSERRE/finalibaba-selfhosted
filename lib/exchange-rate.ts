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
 */
export async function fetchExchangeRateToEur(currency: "USD" | "GBP" | "CHF"): Promise<number | null> {
  try {
    const symbol = CURRENCY_PAIR_SYMBOLS[currency];
    const res = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`,
      {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
        next: { revalidate: 3600 },
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
