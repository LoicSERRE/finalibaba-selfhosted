import type { YFDividendInfo, PricePoint } from "@/lib/analytics";

// Uses the unauthenticated chart endpoint to fetch dividend history.
// Estimates the next ex-div date by extrapolating historical frequency.
export async function fetchYFDividendForSymbol(symbol: string): Promise<YFDividendInfo> {
  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=3mo&range=2y&events=div`,
      {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
        next: { revalidate: 3600 },
      }
    );
    if (!res.ok) return { exDividendDate: null, annualYield: null, annualRatePerShare: null };

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return { exDividendDate: null, annualYield: null, annualRatePerShare: null };

    type DivEvent = { amount: number; date: number };
    const divMap = result.events?.dividends as Record<string, DivEvent> | undefined;
    if (!divMap || Object.keys(divMap).length === 0) {
      return { exDividendDate: null, annualYield: null, annualRatePerShare: null };
    }

    // Sorted ex-div timestamps (keys are Unix seconds)
    const timestamps = Object.keys(divMap).map(Number).sort((a, b) => a - b);
    const amounts = timestamps.map((t) => divMap[String(t)].amount);

    // Estimated frequency in days (monthly / quarterly / semi-annual / annual)
    let freqDays = 365;
    if (timestamps.length >= 2) {
      const gaps = timestamps.slice(1).map((t, i) => (t - timestamps[i]) / 86400);
      const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
      freqDays = median < 45 ? 30 : median < 120 ? 91 : median < 270 ? 182 : 365;
    }
    const perYear = Math.round(365 / freqDays);
    const annualRatePerShare = amounts.slice(-perYear).reduce((s, a) => s + a, 0);

    // Yield = annual rate / current price
    const price = result.meta?.regularMarketPrice as number | undefined;
    const annualYield = price && price > 0 ? annualRatePerShare / price : null;

    // Next ex-div = last + frequency (advanced one cycle if already past)
    const lastTs = timestamps[timestamps.length - 1];
    const nowSec = Date.now() / 1000;
    let nextTs = lastTs + freqDays * 86400;
    if (nextTs < nowSec) nextTs += freqDays * 86400;

    return {
      exDividendDate: new Date(nextTs * 1000),
      annualYield,
      annualRatePerShare,
    };
  } catch {
    return { exDividendDate: null, annualYield: null, annualRatePerShare: null };
  }
}

export async function fetchYFDividends(symbols: string[]): Promise<Record<string, YFDividendInfo>> {
  if (symbols.length === 0) return {};
  const entries = await Promise.all(
    symbols.map(async (s) => [s, await fetchYFDividendForSymbol(s)] as const)
  );
  return Object.fromEntries(entries);
}

// Same unauthenticated chart endpoint as fetchYFDividendForSymbol, but reads
// the OHLC close/timestamp arrays that endpoint also returns instead of
// events.dividends - used to compute a benchmark index's own CAGR over an
// arbitrary lookback window, the same snapshot-to-snapshot way investCAGR
// is computed for the portfolio itself.
export async function fetchYFPriceHistory(symbol: string): Promise<PricePoint[]> {
  try {
    const res = await fetch(
      // "max" rather than a fixed window - investCAGRWeightedYears (the
      // lookback this feeds) can exceed 10 years for a long-held PEA, and
      // clipping the fetch would silently understate an index's CAGR (see
      // priceAt/computeIndexCAGR in lib/analytics.ts for the other half of
      // that fix).
      `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1mo&range=max`,
      {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
        next: { revalidate: 3600 },
      }
    );
    if (!res.ok) return [];

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const timestamps = (result?.timestamp ?? []) as number[];
    const closes = (result?.indicators?.quote?.[0]?.close ?? []) as (number | null)[];

    const points: PricePoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      if (close != null) points.push({ date: new Date(timestamps[i] * 1000), close });
    }
    return points;
  } catch {
    return [];
  }
}
