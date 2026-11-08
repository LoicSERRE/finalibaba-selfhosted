import { beforeEach, describe, expect, it, vi } from "vitest";

// importTransactions as a Server Action: whatever it is sent, it writes only
// rows the import dialog itself would have offered.

const h = vi.hoisted(() => ({ createMany: vi.fn(), rates: vi.fn() }));

vi.mock("@/lib/db/prisma", () => ({ prisma: { transaction: { createMany: h.createMany } } }));
vi.mock("@/lib/actions/manual-account-guard", () => ({ assertManualAccountEligible: async () => ({ currency: "EUR" }) }));
vi.mock("@/lib/services/exchange-rate", () => ({ ratesToBaseForDays: h.rates }));
vi.mock("@/lib/actions/auto-categorize", () => ({ autoCategorizeTransactions: async () => ({ categorized: 0 }) }));
vi.mock("@/lib/actions/revalidate", () => ({ revalidateTransactions: () => {} }));
vi.mock("@/lib/auth-context", () => ({}));
vi.mock("@/lib/services/undo-store", () => ({}));

const { importTransactions } = await import("@/lib/actions/transactions");

beforeEach(() => {
  vi.clearAllMocks();
  h.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
  h.rates.mockImplementation(async (_c: string, days: string[]) => new Map(days.map((d) => [d, 1])));
});

const ACCOUNT = "ckaccount00000000000000001";

describe("importTransactions", () => {
  it("writes the rows a real file gives, French dates normalised", async () => {
    await expect(
      importTransactions(ACCOUNT, [
        { date: "2026-03-01", label: "Loyer", amountCents: -80000 },
        { date: "15/03/2026", label: "Salaire", amountCents: 250000 },
      ]),
    ).resolves.toEqual({ imported: 2 });
    const data = h.createMany.mock.calls[0][0].data;
    expect(data.map((r: { date: Date }) => r.date.toISOString())).toEqual(["2026-03-01T12:00:00.000Z", "2026-03-15T12:00:00.000Z"]);
  });

  it("leaves out a row without a real day, a text label or a finite amount", async () => {
    const rows = [
      { date: "2026-02-30", label: "a", amountCents: 1 },
      { date: "soon", label: "b", amountCents: 1 },
      { date: "2026-03-01", label: { toString: () => "x" }, amountCents: 1 },
      { date: "2026-03-01", label: "c", amountCents: Number.NaN },
      { date: "2026-03-01", label: "d", amountCents: Infinity },
      { date: "2026-03-01", label: "kept", amountCents: 100 },
    ];
    await expect(importTransactions(ACCOUNT, rows as never)).resolves.toEqual({ imported: 1 });
    expect(h.createMany.mock.calls[0][0].data.map((r: { label: string }) => r.label)).toEqual(["kept"]);
    expect(h.rates).toHaveBeenCalledWith("EUR", ["2026-03-01"]);
  });

  it("writes nothing when nothing is valid, and asks for no rate", async () => {
    await expect(importTransactions(ACCOUNT, [{ date: "x", label: "y", amountCents: 1 }])).resolves.toEqual({ imported: 0 });
    await expect(importTransactions(ACCOUNT, "not rows" as never)).resolves.toEqual({ imported: 0 });
    expect(h.createMany).not.toHaveBeenCalled();
    expect(h.rates).not.toHaveBeenCalled();
  });
});
