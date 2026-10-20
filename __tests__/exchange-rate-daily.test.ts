import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The per-day rate cache behind accounts in another currency (v2.18,
 * dev-docs/currencies.md): what is asked of Yahoo, what is stored, and that a
 * day nobody can price comes back null rather than guessed.
 */

const { findManyMock, createManyMock } = vi.hoisted(() => ({ findManyMock: vi.fn(), createManyMock: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: { exchangeRate: { findMany: findManyMock, createMany: createManyMock } },
}));

import { rateToEurOn, ratesToEurForDays } from "@/lib/services/exchange-rate";

const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);
const stamp = (day: string) => Date.parse(`${day}T22:00:00Z`) / 1000;

function yahoo(closes: Record<string, number>) {
  return {
    ok: true,
    json: async () => ({
      chart: { result: [{ timestamp: Object.keys(closes).map(stamp), indicators: { quote: [{ close: Object.values(closes) }] } }] },
    }),
  };
}

beforeEach(() => {
  findManyMock.mockReset().mockResolvedValue([]);
  createManyMock.mockReset().mockResolvedValue({ count: 0 });
});
afterEach(() => vi.unstubAllGlobals());

describe("ratesToEurForDays", () => {
  it("answers EUR without asking anyone", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await rateToEurOn("EUR")).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("serves cached days without a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    findManyMock.mockResolvedValue([{ day: utc("2026-03-05"), rate: 0.9 }]);
    expect(await rateToEurOn("USD", new Date("2026-03-05T12:00:00Z"))).toBeCloseTo(0.9, 10);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches a whole span once, and stores it with the weekend filled in", async () => {
    // Thursday and Friday closes; the file also has a Saturday row.
    const fetchMock = vi.fn().mockResolvedValue(yahoo({ "2026-03-05": 1.25, "2026-03-06": 1.0 }));
    vi.stubGlobal("fetch", fetchMock);

    const rates = await ratesToEurForDays("USD", ["2026-03-07", "2026-03-05", "2026-03-05"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("EURUSD=X");
    expect(rates.get("2026-03-05")).toBeCloseTo(0.8, 10);
    expect(rates.get("2026-03-07")).toBe(1); // Friday's close
    const stored = createManyMock.mock.calls[0][0].data.map((r: { day: Date; rate: number }) => [r.day.toISOString().slice(0, 10), r.rate]);
    expect(stored).toEqual(expect.arrayContaining([["2026-03-05", 0.8], ["2026-03-06", 1], ["2026-03-07", 1]]));
  });

  it("returns null for a day nobody can price, and stores nothing invented", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await rateToEurOn("USD", new Date("2026-03-05T12:00:00Z"))).toBeNull();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it("treats a network failure as no rate", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await rateToEurOn("USD", new Date("2026-03-05T12:00:00Z"))).toBeNull();
  });
});
