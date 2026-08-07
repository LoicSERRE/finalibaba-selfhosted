import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchYFDividendForSymbol, fetchYFDividends, fetchYFPriceHistory } from "@/lib/services/yahoo-finance";

function divEventsFromTimestamps(timestamps: number[], amount: number) {
  const events: Record<string, { amount: number; date: number }> = {};
  for (const t of timestamps) events[String(t)] = { amount, date: t };
  return events;
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchYFDividendForSymbol", () => {
  it("returns all-null when the HTTP response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, false)));
    const info = await fetchYFDividendForSymbol("AAPL");
    expect(info).toEqual({ exDividendDate: null, annualYield: null, annualRatePerShare: null });
  });

  it("returns all-null when there is no dividend history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ chart: { result: [{ meta: {}, events: {} }] } }))
    );
    expect(await fetchYFDividendForSymbol("AAPL")).toEqual({
      exDividendDate: null,
      annualYield: null,
      annualRatePerShare: null,
    });
  });

  it("returns all-null instead of throwing when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await fetchYFDividendForSymbol("AAPL")).toEqual({
      exDividendDate: null,
      annualYield: null,
      annualRatePerShare: null,
    });
  });

  it("infers a quarterly frequency and sums the last 4 payments for the annual rate", async () => {
    const t0 = 1_600_000_000;
    const dayInSec = 86_400;
    const timestamps = [t0, t0 + 91 * dayInSec, t0 + 182 * dayInSec, t0 + 273 * dayInSec];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          chart: {
            result: [
              {
                meta: { regularMarketPrice: 20 },
                events: { dividends: divEventsFromTimestamps(timestamps, 0.5) },
              },
            ],
          },
        })
      )
    );
    const info = await fetchYFDividendForSymbol("XYZ");
    expect(info.annualRatePerShare).toBeCloseTo(2.0, 5); // 4 payments x 0.5
    expect(info.annualYield).toBeCloseTo(2.0 / 20, 5); // annual rate / current price
  });

  it("infers a semi-annual frequency and sums the last 2 payments for the annual rate", async () => {
    const t0 = 1_600_000_000;
    const dayInSec = 86_400;
    // 2 gaps of 182 days -> median=182, which is >= 120 (past the quarterly
    // cutoff) and < 270 (the semi-annual/annual cutoff), landing in the
    // freqDays=182 branch specifically.
    const timestamps = [t0, t0 + 182 * dayInSec, t0 + 364 * dayInSec];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          chart: {
            result: [
              {
                meta: { regularMarketPrice: 15 },
                events: { dividends: divEventsFromTimestamps(timestamps, 1) },
              },
            ],
          },
        })
      )
    );
    const info = await fetchYFDividendForSymbol("XYZ");
    expect(info.annualRatePerShare).toBeCloseTo(2.0, 5); // 2 payments x 1
  });

  it("defaults to an annual frequency (perYear=1) with a single historical payment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          chart: {
            result: [
              {
                meta: { regularMarketPrice: 10 },
                events: { dividends: divEventsFromTimestamps([1_600_000_000], 1.2) },
              },
            ],
          },
        })
      )
    );
    const info = await fetchYFDividendForSymbol("XYZ");
    expect(info.annualRatePerShare).toBeCloseTo(1.2, 5);
  });

  it("returns a null yield (not a crash) when the current price is missing or non-positive", async () => {
    const withoutPrice = jsonResponse({
      chart: { result: [{ meta: {}, events: { dividends: divEventsFromTimestamps([1_600_000_000], 1) } }] },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(withoutPrice));
    expect((await fetchYFDividendForSymbol("XYZ")).annualYield).toBeNull();

    const withZeroPrice = jsonResponse({
      chart: {
        result: [{ meta: { regularMarketPrice: 0 }, events: { dividends: divEventsFromTimestamps([1_600_000_000], 1) } }],
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(withZeroPrice));
    expect((await fetchYFDividendForSymbol("XYZ")).annualYield).toBeNull();
  });

  it("advances the extrapolated next ex-div date by one more cycle when it would otherwise land in the past", async () => {
    const nowSec = Date.now() / 1000;
    const dayInSec = 86_400;
    // Monthly cadence (2 gaps of 30 days -> freqDays=30). Last payment 40
    // days ago: naive extrapolation (last + 30d) would land 10 days in the
    // past, so the function must advance one more cycle to land ~20 days
    // in the future instead of returning a stale date.
    const t0 = nowSec - 70 * dayInSec;
    const t1 = nowSec - 40 * dayInSec;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          chart: {
            result: [
              { meta: { regularMarketPrice: 10 }, events: { dividends: divEventsFromTimestamps([t0, t1], 0.1) } },
            ],
          },
        })
      )
    );
    const info = await fetchYFDividendForSymbol("XYZ");
    expect(info.exDividendDate).not.toBeNull();
    const daysFromNow = (info.exDividendDate!.getTime() - Date.now()) / (dayInSec * 1000);
    expect(daysFromNow).toBeGreaterThan(0); // must be in the future
    expect(daysFromNow).toBeCloseTo(20, 0);
  });
});

describe("fetchYFDividends", () => {
  it("returns an empty object for an empty symbol list without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchYFDividends([])).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches every symbol in parallel and keys the result by symbol", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ chart: { result: [{ meta: {}, events: {} }] } }))
    );
    const result = await fetchYFDividends(["AAPL", "MSFT"]);
    expect(Object.keys(result).sort()).toEqual(["AAPL", "MSFT"]);
  });
});

describe("fetchYFPriceHistory", () => {
  it("pairs timestamps with closes into PricePoints", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          chart: {
            result: [
              {
                timestamp: [1_600_000_000, 1_600_086_400],
                indicators: { quote: [{ close: [100, 105] }] },
              },
            ],
          },
        })
      )
    );
    const points = await fetchYFPriceHistory("URTH");
    expect(points).toHaveLength(2);
    expect(points[0].close).toBe(100);
    expect(points[1].close).toBe(105);
    expect(points[0].date).toEqual(new Date(1_600_000_000 * 1000));
  });

  it("skips indices with a null close instead of pushing a bogus point", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          chart: {
            result: [
              {
                timestamp: [1, 2, 3],
                indicators: { quote: [{ close: [100, null, 110] }] },
              },
            ],
          },
        })
      )
    );
    const points = await fetchYFPriceHistory("URTH");
    expect(points).toHaveLength(2);
    expect(points.map((p) => p.close)).toEqual([100, 110]);
  });

  it("returns an empty array when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, false)));
    expect(await fetchYFPriceHistory("URTH")).toEqual([]);
  });

  it("returns an empty array instead of throwing when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await fetchYFPriceHistory("URTH")).toEqual([]);
  });
});
