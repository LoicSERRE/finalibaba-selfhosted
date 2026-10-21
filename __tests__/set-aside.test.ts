import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * v2.21: money set aside - savings and investing - is neither spending nor
 * income, and Budgets now says where it went instead of dropping it.
 */

const m = vi.hoisted(() => ({ txFind: vi.fn(), splitFind: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { transaction: { findMany: m.txFind }, transactionSplit: { findMany: m.splitFind } } }));

import { computeSetAside, totalSetAside, type SetAsideTx } from "@/lib/domain/set-aside";
import { buildMoneyFlow, moneyFlowFromMaps, type FlowPart } from "@/lib/domain/money-flow";
import { periodSetAside } from "@/lib/services/budget-period";

const tx = (over: Partial<SetAsideTx>): SetAsideTx => ({
  amountCents: 0,
  isInternalTransfer: false,
  isSecuritiesMovement: false,
  counterpartAccountType: null,
  savingsCategoryId: null,
  ...over,
});

describe("computeSetAside", () => {
  it("tells savings from investing by where the money went", () => {
    const result = computeSetAside([
      tx({ amountCents: -300_00, isInternalTransfer: true, counterpartAccountType: "SAVINGS" }),
      tx({ amountCents: -50_00, isSecuritiesMovement: true }),
      tx({ amountCents: -100_00, isInternalTransfer: true, counterpartAccountType: "CRYPTO" }),
      tx({ amountCents: -20_00, isInternalTransfer: true, counterpartAccountType: "INVESTMENT" }),
    ]);
    expect(result.savingsCents).toBe(300_00);
    expect(result.investmentCents).toBe(170_00);
    expect(totalSetAside(result)).toBe(470_00);
  });

  it("deducts what comes back, and can go below zero", () => {
    const result = computeSetAside([
      tx({ amountCents: -100_00, isInternalTransfer: true, counterpartAccountType: "SAVINGS" }),
      tx({ amountCents: 400_00, isInternalTransfer: true, counterpartAccountType: "SAVINGS" }),
      // Shares sold: the cash lands back on the current account.
      tx({ amountCents: 30_00, isSecuritiesMovement: true }),
    ]);
    expect(result.savingsCents).toBe(-300_00);
    expect(result.investmentCents).toBe(-30_00);
  });

  it("counts nothing that is not money kept", () => {
    const result = computeSetAside([
      // Between two current accounts.
      tx({ amountCents: -200_00, isInternalTransfer: true, counterpartAccountType: "CHECKING" }),
      // A loan repayment.
      tx({ amountCents: -150_00, isInternalTransfer: true, counterpartAccountType: "LOAN" }),
      // Marked internal by hand, no pair: nowhere to say it went.
      tx({ amountCents: -5000_00, isInternalTransfer: true }),
    ]);
    expect(totalSetAside(result)).toBe(0);
  });

  it("lets the user's own category win over what the app infers", () => {
    const result = computeSetAside([
      tx({ amountCents: -25_00, isSecuritiesMovement: true, savingsCategoryId: "pea" }),
      tx({ amountCents: -75_00, isInternalTransfer: true, counterpartAccountType: "SAVINGS", savingsCategoryId: "pea" }),
      // An ordinary debit - a transfer to an insurer the app does not know.
      tx({ amountCents: -60_00, savingsCategoryId: "av" }),
    ]);
    expect(result.byCategory).toEqual(new Map([["pea", 100_00], ["av", 60_00]]));
    expect(result.savingsCents).toBe(0);
    expect(result.investmentCents).toBe(0);
    expect(totalSetAside(result)).toBe(160_00);
  });
});

describe("periodSetAside", () => {
  beforeEach(() => {
    m.txFind.mockReset();
    m.splitFind.mockReset();
  });

  it("reads current accounts only, and the transfer's other leg among the viewer's accounts", async () => {
    m.txFind
      .mockResolvedValueOnce([
        { amountCents: BigInt(-800_00), isInternalTransfer: true, isSecuritiesMovement: false, categoryId: null, internalTransferPairId: "leg-livret" },
        { amountCents: BigInt(-90_00), isInternalTransfer: true, isSecuritiesMovement: false, categoryId: null, internalTransferPairId: "leg-elsewhere" },
        { amountCents: BigInt(-10_00), isInternalTransfer: false, isSecuritiesMovement: true, categoryId: null, internalTransferPairId: null },
        { amountCents: BigInt(-40_00), isInternalTransfer: false, isSecuritiesMovement: false, categoryId: "av", internalTransferPairId: null },
      ])
      // leg-elsewhere sits on an account the viewer cannot see.
      .mockResolvedValueOnce([{ id: "leg-livret", account: { type: "SAVINGS" } }]);
    m.splitFind.mockResolvedValueOnce([{ amountCents: BigInt(-5_00), categoryId: "av" }]);

    const start = new Date(Date.UTC(2026, 9, 1));
    const end = new Date(Date.UTC(2026, 10, 1));
    const result = await periodSetAside(["acc1", "acc2"], start, end, new Set(["av"]));

    expect(result).toEqual({ savingsCents: 800_00, investmentCents: 10_00, byCategory: new Map([["av", 45_00]]) });
    const where = m.txFind.mock.calls[0][0].where;
    expect(where).toMatchObject({
      accountId: { in: ["acc1", "acc2"] },
      account: { type: { in: ["CHECKING", "MEAL_VOUCHER"] } },
      date: { gte: start, lt: end },
      splits: { none: {} },
    });
    expect(m.txFind.mock.calls[1][0].where).toEqual({ id: { in: ["leg-livret", "leg-elsewhere"] }, accountId: { in: ["acc1", "acc2"] } });
    expect(m.splitFind.mock.calls[0][0].where).toMatchObject({ categoryId: { in: ["av"] }, transaction: { account: { type: { in: ["CHECKING", "MEAL_VOUCHER"] } } } });
  });

  it("skips the pair lookup when there is no transfer", async () => {
    m.txFind.mockResolvedValueOnce([]);
    m.splitFind.mockResolvedValueOnce([]);
    const result = await periodSetAside(["acc1"], new Date(), new Date());
    expect(totalSetAside(result)).toBe(0);
    expect(m.txFind).toHaveBeenCalledTimes(1);
  });
});

describe("the money flow with money set aside", () => {
  const L = {
    income: "Revenus",
    savings: "Épargne",
    drawn: "Pris sur l'épargne",
    other: "Autres",
    leftover: "Reste sur les comptes",
    drawnCurrent: "Pris sur les comptes",
  };
  const part = (id: string, cents: number): FlowPart => ({ id, name: id, cents, color: "#000" });

  it("draws it beside the spending, never inside it, and names what is left", () => {
    const flow = buildMoneyFlow([part("Salaire", 2000_00)], [part("Loyer", 800_00)], L, [part("Livret", 500_00)])!;
    expect(flow.nodes.map((n) => n.name)).toEqual(["Salaire", "Revenus", "Loyer", "Livret", "Reste sur les comptes"]);
    expect(flow.nodes.at(-1)!.cents).toBe(700_00);
    expect(flow.spentCents).toBe(800_00);
    expect(flow.incomeCents).toBe(2000_00);
  });

  it("takes a shortfall from the current accounts, and money taken back flows in", () => {
    const flow = buildMoneyFlow([part("Salaire", 1000_00)], [part("Loyer", 800_00)], L, [part("Livret", 900_00), part("PEA", -100_00)])!;
    expect(flow.nodes.map((n) => n.name)).toEqual(["Salaire", "PEA", "Pris sur les comptes", "Revenus", "Loyer", "Livret"]);
    expect(flow.nodes[1].cents).toBe(100_00);
    expect(flow.nodes[2].cents).toBe(600_00);
  });

  it("keeps the old names when nothing was set aside", () => {
    const flow = buildMoneyFlow([part("Salaire", 1000_00)], [part("Loyer", 400_00)], L, [])!;
    expect(flow.nodes.at(-1)!.name).toBe("Épargne");
  });

  it("draws a month with only money set aside", () => {
    const flow = buildMoneyFlow([], [], L, [part("Livret", 300_00)]);
    expect(flow?.nodes.map((n) => n.name)).toEqual(["Pris sur les comptes", "Revenus", "Livret"]);
  });

  it("names the inferred lines by direction, and SAVINGS categories by their own name", () => {
    const flow = moneyFlowFromMaps(
      new Map([["salary", 2000_00]]),
      new Map(),
      [
        { id: "salary", name: "Salaire", color: "#0f0" },
        { id: "pea", name: "PEA", color: "#00f" },
      ],
      {
        ...L,
        uncategorizedIncome: "?",
        uncategorizedSpend: "?",
        setSavings: "Vers vos livrets",
        takenFromSavings: "Retiré de vos livrets",
        setInvestment: "Titres et placements",
        takenFromInvestment: "Retiré de vos placements",
      },
      { savingsCents: -200_00, investmentCents: 50_00, byCategory: new Map([["pea", 300_00]]) }
    )!;
    expect(flow.nodes.map((n) => n.name)).toEqual(["Salaire", "Retiré de vos livrets", "Revenus", "Titres et placements", "PEA", "Reste sur les comptes"]);
  });
});
