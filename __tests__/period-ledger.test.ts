import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * v2.21.1: every line of a period in exactly one place, so that the current
 * accounts' change is income - spending - set aside + other movements, by
 * construction. v2.21 had no place for a loan paid out or a transfer in from
 * an untracked bank, and read "2 800 EUR taken from your current accounts"
 * on a month they moved by -300 EUR.
 */

const m = vi.hoisted(() => ({ txFind: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { transaction: { findMany: m.txFind } } }));

import { partitionPeriod, totalOther, type CategoryKindName, type LedgerLine } from "@/lib/domain/period-ledger";
import { totalSetAside } from "@/lib/domain/set-aside";
import { loadPeriodLedger } from "@/lib/services/budget-period";

const KINDS = new Map<string, CategoryKindName>([
  ["salary", "INCOME"],
  ["food", "EXPENSE"],
  ["health", "EXPENSE"],
  ["pea", "SAVINGS"],
]);

let n = 0;
const line = (over: Partial<LedgerLine>): LedgerLine => ({
  transactionId: `tx${n++}`,
  date: new Date(Date.UTC(2026, 9, 15, 12)),
  label: "x",
  accountName: "Compte courant",
  accountType: "CHECKING",
  amountCents: 0,
  categoryId: null,
  isInternalTransfer: false,
  isSecuritiesMovement: false,
  counterpartAccountType: null,
  ...over,
});
const sum = (map: ReadonlyMap<unknown, number>) => [...map.values()].reduce((a, b) => a + b, 0);
const identity = (ledger: ReturnType<typeof partitionPeriod>) =>
  sum(ledger.incomeMap) - sum(ledger.spendMap) - totalSetAside(ledger.setAside) + totalOther(ledger.other);

describe("partitionPeriod", () => {
  it("tells savings from investing by where the money went, and deducts what comes back", () => {
    const ledger = partitionPeriod(
      [
        line({ amountCents: -300_00, isInternalTransfer: true, counterpartAccountType: "SAVINGS" }),
        line({ amountCents: 100_00, isInternalTransfer: true, counterpartAccountType: "SAVINGS" }),
        line({ amountCents: -50_00, isSecuritiesMovement: true }),
        // A securities movement also marked internal is still investing.
        line({ amountCents: -10_00, isSecuritiesMovement: true, isInternalTransfer: true }),
        line({ amountCents: -100_00, isInternalTransfer: true, counterpartAccountType: "CRYPTO" }),
        line({ amountCents: -20_00, isInternalTransfer: true, counterpartAccountType: "INVESTMENT" }),
      ],
      KINDS
    );
    expect(ledger.setAside.savingsCents).toBe(200_00);
    expect(ledger.setAside.investmentCents).toBe(180_00);
    expect(ledger.currentChangeCents).toBe(-380_00);
    expect(ledger.incomeMap.size + ledger.spendMap.size).toBe(0);
  });

  it("places what is neither income, spending nor set aside, and lists it", () => {
    const loanIn = line({ amountCents: 2500_00, isInternalTransfer: true, counterpartAccountType: "LOAN", date: new Date(Date.UTC(2026, 9, 19)) });
    const untrackedIn = line({ amountCents: 1200_00, isInternalTransfer: true, date: new Date(Date.UTC(2026, 9, 20)) });
    const ledger = partitionPeriod(
      [
        loanIn,
        line({ amountCents: -350_00, isInternalTransfer: true, counterpartAccountType: "LOAN" }),
        untrackedIn,
        line({ amountCents: -40_00, isInternalTransfer: true, counterpartAccountType: "REAL_ESTATE" }),
        // Both legs of a move between two current accounts: zero, not listed.
        line({ amountCents: -200_00, isInternalTransfer: true, counterpartAccountType: "CHECKING" }),
        line({ amountCents: 200_00, isInternalTransfer: true, counterpartAccountType: "MEAL_VOUCHER", accountType: "MEAL_VOUCHER" }),
      ],
      KINDS
    );
    expect(ledger.other).toEqual({
      loanInCents: 2500_00,
      loanOutCents: -350_00,
      untrackedInCents: 1200_00,
      untrackedOutCents: -40_00,
      betweenCents: 0,
      elsewhereCents: 0,
    });
    expect(ledger.otherLines).toHaveLength(4);
    expect(ledger.otherLines.slice(0, 2)).toEqual([untrackedIn, loanIn]);
    expect(ledger.currentChangeCents).toBe(3310_00);
    expect(identity(ledger)).toBe(ledger.currentChangeCents);
  });

  it("lets a SAVINGS category win over what the app infers", () => {
    const ledger = partitionPeriod(
      [
        line({ amountCents: -25_00, isSecuritiesMovement: true, categoryId: "pea" }),
        line({ amountCents: -75_00, isInternalTransfer: true, counterpartAccountType: "SAVINGS", categoryId: "pea" }),
        line({ amountCents: -60_00, categoryId: "pea" }),
      ],
      KINDS
    );
    expect(ledger.setAside).toEqual({ savingsCents: 0, investmentCents: 0, byCategory: new Map([["pea", 160_00]]) });
  });

  it("nets refunds per category, goes by sign when uncategorized, and keeps a foreign category out", () => {
    const ledger = partitionPeriod(
      [
        line({ amountCents: -80_00, categoryId: "health" }),
        line({ amountCents: 50_00, categoryId: "health" }),
        line({ amountCents: -10_00, categoryId: "food" }),
        line({ amountCents: 30_00, categoryId: "food" }),
        line({ amountCents: 2000_00, categoryId: "salary" }),
        line({ amountCents: -100_00, categoryId: "salary" }),
        line({ amountCents: 4_00 }),
        line({ amountCents: -9_00 }),
        // A co-owner's category on a joint account: not the viewer's to name.
        line({ amountCents: -7_00, categoryId: "theirs" }),
      ],
      KINDS
    );
    expect(ledger.spendMap).toEqual(new Map([["health", 30_00], ["food", -20_00], [null, 16_00]]));
    expect(ledger.incomeMap).toEqual(new Map([["salary", 1900_00], [null, 4_00]]));
    expect(identity(ledger)).toBe(ledger.currentChangeCents);
  });

  it("keeps what a livret or brokerage account earns or costs there, and bridges a loan account's own lines", () => {
    const ledger = partitionPeriod(
      [
        line({ amountCents: 120_00, categoryId: "salary", accountType: "SAVINGS" }),
        line({ amountCents: -5_00, categoryId: "food", accountType: "INVESTMENT" }),
        line({ amountCents: 350_00, accountType: "LOAN", label: "Échéance" }),
        // Money already set aside changing place: nothing.
        line({ amountCents: 300_00, accountType: "SAVINGS", isInternalTransfer: true }),
        line({ amountCents: -300_00, accountType: "INVESTMENT", isSecuritiesMovement: true }),
        line({ amountCents: -40_00, accountType: "SAVINGS", categoryId: "pea" }),
      ],
      KINDS
    );
    expect(ledger.incomeMap).toEqual(new Map([["salary", 120_00], [null, 350_00]]));
    expect(ledger.spendMap).toEqual(new Map([["food", 5_00]]));
    expect(ledger.setAside).toEqual({ savingsCents: 120_00, investmentCents: -5_00, byCategory: new Map() });
    expect(ledger.other.elsewhereCents).toBe(-350_00);
    expect(ledger.otherLines.map((l) => [l.label, l.amountCents])).toEqual([["Échéance", 350_00]]);
    expect(ledger.currentChangeCents).toBe(0);
    expect(identity(ledger)).toBe(0);
  });

  it("buckets income and spending by calendar month", () => {
    const ledger = partitionPeriod(
      [
        line({ amountCents: 3800_00, categoryId: "salary", date: new Date(Date.UTC(2026, 0, 28)) }),
        line({ amountCents: -850_00, categoryId: "food", date: new Date(Date.UTC(2026, 0, 5)) }),
        line({ amountCents: 20_00, categoryId: "food", date: new Date(Date.UTC(2026, 0, 6)) }),
        line({ amountCents: -42_50, date: new Date(Date.UTC(2026, 1, 3)) }),
        line({ amountCents: -999_00, isInternalTransfer: true, counterpartAccountType: "SAVINGS", date: new Date(Date.UTC(2026, 1, 4)) }),
      ],
      KINDS
    );
    expect(ledger.byMonth).toEqual(
      new Map([
        ["2026-01", { incomeCents: 3800_00, expenseCents: 830_00 }],
        ["2026-02", { incomeCents: 0, expenseCents: 42_50 }],
      ])
    );
  });

  it("reads a month whose livret transfer a loan paid for: not taken from the current accounts", () => {
    const ledger = partitionPeriod(
      [
        line({ amountCents: 1000_00, categoryId: "salary" }),
        line({ amountCents: -800_00, categoryId: "food" }),
        line({ amountCents: -3000_00, isInternalTransfer: true, counterpartAccountType: "SAVINGS" }),
        // Paid out by a bank the app does not follow, marked internal by hand.
        line({ amountCents: 2500_00, isInternalTransfer: true, label: "Prêt" }),
        // Marked internal, yet filed under an income category: the mark wins.
        line({ amountCents: 100_00, isInternalTransfer: true, categoryId: "salary", label: "Aide" }),
      ],
      KINDS
    );
    expect(totalSetAside(ledger.setAside)).toBe(3000_00);
    expect(ledger.other.untrackedInCents).toBe(2600_00);
    // v2.21 read 200 - 3 000 = 2 800 taken. 200 - 3 000 + 2 600 = -200.
    expect(ledger.currentChangeCents).toBe(-200_00);
    expect(identity(ledger)).toBe(-200_00);
  });

  it("adds up, whatever the lines", () => {
    // A seeded generator: the same 2 000 periods on every run.
    let seed = 42;
    const rand = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
    const TYPES = ["CHECKING", "MEAL_VOUCHER", "SAVINGS", "INVESTMENT", "CRYPTO", "LOAN", "REAL_ESTATE", "AUTOMOBILE"];
    const CATEGORIES = [null, "salary", "food", "health", "pea", "theirs"];
    for (let trial = 0; trial < 2000; trial++) {
      const lines = Array.from({ length: Math.floor(rand() * 12) }, () =>
        line({
          accountType: pick(TYPES),
          amountCents: Math.round((rand() - 0.5) * 200_000),
          categoryId: pick(CATEGORIES),
          isInternalTransfer: rand() < 0.3,
          isSecuritiesMovement: rand() < 0.15,
          counterpartAccountType: rand() < 0.3 ? null : pick(TYPES),
          date: new Date(Date.UTC(2026, Math.floor(rand() * 12), 10)),
        })
      );
      const ledger = partitionPeriod(lines, KINDS);
      expect(identity(ledger)).toBe(ledger.currentChangeCents);
      const months = [...ledger.byMonth.values()];
      expect(months.reduce((s, x) => s + x.incomeCents, 0)).toBe(sum(ledger.incomeMap));
      expect(months.reduce((s, x) => s + x.expenseCents, 0)).toBe(sum(ledger.spendMap));
    }
  });
});

describe("loadPeriodLedger", () => {
  beforeEach(() => m.txFind.mockReset());

  const tx = (over: Record<string, unknown>) => ({
    id: "t",
    date: new Date(Date.UTC(2026, 9, 6)),
    label: "x",
    amountCents: BigInt(0),
    categoryId: null,
    isInternalTransfer: false,
    isSecuritiesMovement: false,
    internalTransferPairId: null,
    account: { name: "Compte courant", type: "CHECKING" },
    splits: [],
    ...over,
  });

  it("reads split lines in place of their parent, and the transfer's other leg among the viewer's accounts", async () => {
    m.txFind
      .mockResolvedValueOnce([
        tx({ id: "a", amountCents: BigInt(-800_00), isInternalTransfer: true, internalTransferPairId: "leg-livret" }),
        tx({ id: "b", amountCents: BigInt(-90_00), isInternalTransfer: true, internalTransferPairId: "leg-elsewhere" }),
        tx({ id: "c", amountCents: BigInt(-50_00), splits: [{ amountCents: BigInt(-30_00), categoryId: "food" }, { amountCents: BigInt(-20_00), categoryId: "pea" }] }),
      ])
      // leg-elsewhere sits on an account the viewer cannot see.
      .mockResolvedValueOnce([{ id: "leg-livret", account: { type: "SAVINGS" } }]);

    const start = new Date(Date.UTC(2026, 9, 1));
    const end = new Date(Date.UTC(2026, 10, 1));
    const ledger = await loadPeriodLedger(["acc1", "acc2"], start, end, [...KINDS].map(([id, kind]) => ({ id, kind })));

    expect(m.txFind.mock.calls[0][0].where).toEqual({ accountId: { in: ["acc1", "acc2"] }, date: { gte: start, lt: end } });
    expect(m.txFind.mock.calls[1][0].where).toEqual({ id: { in: ["leg-livret", "leg-elsewhere"] }, accountId: { in: ["acc1", "acc2"] } });
    expect(ledger.setAside).toEqual({ savingsCents: 800_00, investmentCents: 0, byCategory: new Map([["pea", 20_00]]) });
    expect(ledger.spendMap).toEqual(new Map([["food", 30_00]]));
    expect(ledger.other.untrackedOutCents).toBe(-90_00);
    expect(ledger.currentChangeCents).toBe(-940_00);
  });

  it("skips the pair lookup when there is no transfer", async () => {
    m.txFind.mockResolvedValueOnce([tx({ amountCents: BigInt(-5_00) })]);
    await loadPeriodLedger(["acc1"], new Date(), new Date(), []);
    expect(m.txFind).toHaveBeenCalledTimes(1);
  });
});
