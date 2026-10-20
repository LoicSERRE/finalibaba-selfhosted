// Reuses the same unauthenticated Yahoo Finance chart endpoint/headers/
// caching convention already established in app/analytics/page.tsx
// (fetchYFDividendForSymbol/fetchYFPriceHistory) - extracted here, not kept
// page-local, since this is the first Yahoo fetch needed from a Server
// Action (lib/actions/holdings.ts) rather than a page.

/** Yahoo's pair for "`currency` per 1 `base`" - inverted below into base per 1 `currency`. */
function yahooPair(base: string, currency: string): string {
  return `${base}${currency}=X`;
}

/**
 * Base currency per 1 unit of `currency` (e.g. ~0.92 EUR for a USD), or null
 * on failure; 1 for the base itself. Yahoo's BASExxx=X pairs quote "xxx per 1
 * BASE", so the raw price is inverted. (Named ...ToEur until v2.19 made the
 * base configurable - dev-docs/currencies.md.)
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
import { prisma } from "@/lib/db/prisma";
import { dayKey, isBaseCurrency, parseYahooDailyRates, pickRate } from "@/lib/domain/currency";
import { baseCurrency } from "@/lib/utils/base-currency";

export async function fetchExchangeRateToBase(currency: string, bypassCache?: boolean): Promise<number | null> {
  const base = baseCurrency();
  if (currency === base) return 1;
  try {
    const symbol = yahooPair(base, currency);
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

// ── Daily rates for accounts kept in another currency (v2.18) ───────────────
// dev-docs/currencies.md. Unlike the holding rate above (one figure captured
// at entry), an account converts every balance and transaction at the rate
// of its own day, so rates are cached per day in ExchangeRate - shared with
// the sync service (sync/fx.py), which converts what banks report. Keyed by
// base as well (v2.19): rates into another base are different rows.

const DAY_MS = 86_400_000;
const LOOKBACK_DAYS = 7;

async function fetchDailyRates(currency: string, from: Date, to: Date): Promise<{ day: string; rate: number }[]> {
  try {
    const period1 = Math.floor(from.getTime() / 1000);
    const period2 = Math.floor(to.getTime() / 1000);
    const res = await fetchExternal(
      `https://query2.finance.yahoo.com/v8/finance/chart/${yahooPair(baseCurrency(), currency)}?interval=1d&period1=${period1}&period2=${period2}`,
      { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }, cache: "no-store" }
    );
    if (!res.ok) return [];
    return parseYahooDailyRates(await res.json());
  } catch {
    return [];
  }
}

/**
 * Base currency per 1 unit of `currency` for each of `days` (YYYY-MM-DD): one cache
 * read and at most one Yahoo request for the whole span, so a year of CSV
 * rows costs the same as one. A day maps to null when no close within a week
 * before it exists - callers refuse the write then, never guess. A day
 * without a close (a weekend) takes the previous one and is stored under its
 * own day, so the next ask is a hit.
 */
export async function ratesToBaseForDays(currency: string, days: readonly string[]): Promise<Map<string, number | null>> {
  const unique = [...new Set(days)].sort();
  if (isBaseCurrency(currency)) return new Map(unique.map((day) => [day, 1]));
  if (unique.length === 0) return new Map();

  const first = new Date(`${unique[0]}T00:00:00.000Z`);
  const last = new Date(`${unique.at(-1)}T00:00:00.000Z`);
  const from = new Date(first.getTime() - LOOKBACK_DAYS * DAY_MS);
  const cached = (
    await prisma.exchangeRate.findMany({
      where: { base: baseCurrency(), currency, day: { gte: from, lte: last } },
      select: { day: true, rate: true },
    })
  ).map((row) => ({ day: dayKey(row.day), rate: row.rate }));
  const known = new Set(cached.map((row) => row.day));
  if (unique.every((day) => known.has(day))) return new Map(unique.map((day) => [day, pickRate(cached, day)]));

  const fetched = await fetchDailyRates(currency, from, new Date(last.getTime() + DAY_MS));
  const all = [...cached, ...fetched];
  const result = new Map(unique.map((day) => [day, pickRate(all, day)]));

  const fetchedDays = new Set(fetched.map((row) => row.day));
  const filled = unique
    .filter((day) => !known.has(day) && !fetchedDays.has(day))
    .flatMap((day) => {
      const rate = result.get(day);
      return rate === null || rate === undefined ? [] : [{ day, rate }];
    });
  const toStore = [...fetched.filter((row) => !known.has(row.day)), ...filled];
  if (toStore.length) {
    await prisma.exchangeRate.createMany({
      data: toStore.map((row) => ({ base: baseCurrency(), currency, day: new Date(`${row.day}T00:00:00.000Z`), rate: row.rate })),
      skipDuplicates: true,
    });
  }
  return result;
}

/** One day's rate (today by default); see ratesToBaseForDays. Optional
 *  rather than `= new Date()`: a defaulted parameter hides the function
 *  from lizard (scripts/lizard-blind-spots.py). */
export async function rateToBaseOn(currency: string, date?: Date): Promise<number | null> {
  const day = dayKey(date ?? new Date());
  return (await ratesToBaseForDays(currency, [day])).get(day) ?? null;
}
