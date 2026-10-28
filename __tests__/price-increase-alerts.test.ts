import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * v2.20: the price-increase alert fires once per new price, and "update the
 * amount" only ever confirms the price the transactions show.
 */

const m = vi.hoisted(() => ({
  seriesFind: vi.fn(),
  seriesFindUnique: vi.fn(),
  seriesUpdate: vi.fn(),
  txFind: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    recurringTransaction: { findMany: m.seriesFind, findUnique: m.seriesFindUnique, update: m.seriesUpdate },
    transaction: { findMany: m.txFind },
  },
}));
vi.mock("@/lib/services/notifications", () => ({ dispatchAlert: m.dispatch }));
vi.mock("@/lib/auth-context", () => ({
  getViewer: vi.fn(async () => ({ id: "user-owner" })),
  assertAccountWritable: vi.fn(async () => {}),
  assertOwned: vi.fn(async () => {}),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { checkPriceIncreaseAlerts } from "@/lib/services/alerts/price-increases";
import { acceptRecurringPrice } from "@/lib/actions/recurring";
import type { UserSettingsModel } from "@/app/generated/prisma/models";

// The latest expected charge is yesterday at noon UTC - always in the past,
// whatever the hour the test runs - so the tests need no fake clock. Not
// today: occurrences land at noon UTC (addMonthsClamped), so today's is still
// ahead of the clock before 12:00 UTC, which is when Dependabot's CI runs.
const now = new Date();
const chargeDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 12));
// The anchor is itself an occurrence: no month arithmetic to trip on a 29 February.
const anchor = chargeDate;
const series = (priceAlertedCents: bigint | null = null) => ({
  id: "r1", accountId: "acc1", label: "NETFLIX.COM", amountCents: BigInt(-13_49), amountVaries: false,
  frequency: "MONTHLY", intervalCount: 1, anchorDate: anchor, priceAlertedCents, account: { name: "Compte courant" },
});
const charged = (cents: number) => [{ accountId: "acc1", label: "NETFLIX.COM", amountCents: BigInt(-cents), date: chargeDate }];
const settings = (on = true) => ({ userId: "user-owner", priceIncreaseAlertsEnabled: on }) as unknown as UserSettingsModel;

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.seriesUpdate.mockResolvedValue({});
});

describe("checkPriceIncreaseAlerts", () => {
  it("alerts once, with the old and new price, and remembers it", async () => {
    m.seriesFind.mockResolvedValue([series()]);
    m.txFind.mockResolvedValue(charged(14_99));
    expect(await checkPriceIncreaseAlerts(settings(), ["acc1"])).toEqual(["r1"]);
    const [, title, body] = m.dispatch.mock.calls[0];
    expect(title).toContain("NETFLIX.COM");
    expect(body).toMatch(/13,49.*14,99.*18,00/);
    expect(m.seriesUpdate).toHaveBeenCalledWith({ where: { id: "r1" }, data: { priceAlertedCents: BigInt(-14_99) } });
  });

  it("stays quiet for a price already announced", async () => {
    m.seriesFind.mockResolvedValue([series(BigInt(-14_99))]);
    m.txFind.mockResolvedValue(charged(14_99));
    expect(await checkPriceIncreaseAlerts(settings(), ["acc1"])).toEqual([]);
    expect(m.dispatch).not.toHaveBeenCalled();
  });

  it("stays quiet when switched off, even for a new price", async () => {
    m.seriesFind.mockResolvedValue([series()]);
    m.txFind.mockResolvedValue(charged(14_99));
    expect(await checkPriceIncreaseAlerts(settings(false), ["acc1"])).toEqual([]);
    expect(m.dispatch).not.toHaveBeenCalled();
  });

  it("announces the next increase too", async () => {
    m.seriesFind.mockResolvedValue([series(BigInt(-14_99))]);
    m.txFind.mockResolvedValue(charged(16_99));
    expect(await checkPriceIncreaseAlerts(settings(), ["acc1"])).toEqual(["r1"]);
  });
});

describe("acceptRecurringPrice", () => {
  it("sets the template to the price the bank charged", async () => {
    m.seriesFindUnique.mockResolvedValue({ accountId: "acc1" });
    m.seriesFind.mockResolvedValue([series()]);
    m.txFind.mockResolvedValue(charged(14_99));
    expect(await acceptRecurringPrice("r1")).toEqual({ ok: true, data: undefined });
    expect(m.seriesUpdate).toHaveBeenCalledWith({ where: { id: "r1" }, data: { amountCents: BigInt(-14_99) } });
  });

  it("refuses when there is no increase left to confirm", async () => {
    m.seriesFindUnique.mockResolvedValue({ accountId: "acc1" });
    m.seriesFind.mockResolvedValue([series()]);
    m.txFind.mockResolvedValue(charged(13_49));
    expect(await acceptRecurringPrice("r1")).toEqual({ ok: false, error: "no_price_change" });
    expect(m.seriesUpdate).not.toHaveBeenCalled();
  });
});
