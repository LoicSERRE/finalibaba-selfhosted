import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchExchangeRateToEur } from "@/lib/services/exchange-rate";

function mockYahooResponse(regularMarketPrice: number | undefined) {
  return {
    ok: true,
    json: async () => ({
      chart: { result: [{ meta: { regularMarketPrice } }] },
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchExchangeRateToEur", () => {
  it("inverts Yahoo's quote (xxx per 1 EUR) into EUR per 1 unit of currency - the critical correctness point", async () => {
    // EURUSD=X quotes "1.08 USD per 1 EUR" - fetchExchangeRateToEur must
    // return "EUR per 1 USD" (≈0.9259), the inverse. Getting this backwards
    // would silently multiply every USD holding's EUR value by ~1.17x
    // instead of dividing, corrupting every multi-currency valuation.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockYahooResponse(1.08)));
    const rate = await fetchExchangeRateToEur("USD");
    expect(rate).toBeCloseTo(1 / 1.08, 10);
    expect(rate).toBeLessThan(1); // sanity: EUR is worth more than 1 USD at this quote
  });

  it("requests the correct Yahoo symbol per currency", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockYahooResponse(1));
    vi.stubGlobal("fetch", fetchMock);

    await fetchExchangeRateToEur("USD");
    expect(fetchMock.mock.calls[0][0]).toContain("EURUSD=X");

    await fetchExchangeRateToEur("GBP");
    expect(fetchMock.mock.calls[1][0]).toContain("EURGBP=X");

    await fetchExchangeRateToEur("CHF");
    expect(fetchMock.mock.calls[2][0]).toContain("EURCHF=X");
  });

  it("returns null (not a stale/wrong fallback) when the HTTP response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await fetchExchangeRateToEur("USD")).toBeNull();
  });

  it("returns null when the response has no usable price", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockYahooResponse(undefined)));
    expect(await fetchExchangeRateToEur("USD")).toBeNull();
  });

  it("returns null for a zero or negative price instead of dividing by zero / inverting a negative", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockYahooResponse(0)));
    expect(await fetchExchangeRateToEur("USD")).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockYahooResponse(-1)));
    expect(await fetchExchangeRateToEur("USD")).toBeNull();
  });

  it("returns null instead of throwing when fetch itself rejects (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await fetchExchangeRateToEur("USD")).toBeNull();
  });

  it("returns null instead of throwing on a malformed JSON body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ unexpected: "shape" }) })
    );
    expect(await fetchExchangeRateToEur("USD")).toBeNull();
  });
});
