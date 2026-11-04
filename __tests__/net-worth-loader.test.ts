import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/services/net-worth.ts: where a person's company shares are loaded. What
// a mocked dashboard cannot show: only an ACCEPTED link counts; a company is
// valued on its own accounts, minus what it owes its associates on their
// current accounts; and the person's own current account is theirs on top.

const h = vi.hoisted(() => ({
  associateFindMany: vi.fn(),
  accountFindMany: vi.fn(),
  balanceFindMany: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    companyAssociate: { findMany: h.associateFindMany },
    account: { findMany: h.accountFindMany },
    historicalBalance: { findMany: h.balanceFindMany },
  },
}));

const { computePortfolio, loadCompanyShares } = await import("@/lib/services/net-worth");

const NOW = new Date("2026-07-28T12:00:00Z");

function cash(id: string, cents: number) {
  return {
    id, name: id, type: "CHECKING", institutionId: null, institution: null, taxTreatment: "TAXABLE",
    taxRatePct: null, manualValueCents: null, liabilityCents: null, loanAmountCents: null, loanTaeg: null,
    loanDurationMonths: null, loanDeferralMonths: null, loanStartDate: null, holdings: [],
    history: [{ balanceCents: BigInt(cents) }],
  };
}

/** The user's associate row in a 1000-part SCI whose bank account holds 180 000. */
function row(parts: number[], ownCents: number, allCents: number[]) {
  return {
    currentAccountCents: BigInt(ownCents),
    holdings: parts.map((p) => ({ parts: p })),
    company: {
      id: "co-1",
      name: "SCI",
      totalParts: 1000,
      associates: allCents.map((c) => ({ currentAccountCents: BigInt(c) })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.balanceFindMany.mockResolvedValue([]);
  h.accountFindMany.mockImplementation(async ({ where, select }: { where: { companyId?: string; id?: { in: string[] } }; select?: unknown }) => {
    if (select) return where.companyId === "co-1" ? [{ id: "sci-bank" }] : [];
    return (where.id?.in ?? []).map((id) => cash(id, id === "sci-bank" ? 180_000_00 : 10_000_00));
  });
});

describe("loadCompanyShares", () => {
  it("only reads the user's ACCEPTED associate rows", async () => {
    h.associateFindMany.mockResolvedValue([]);
    await loadCompanyShares("user-b", NOW);
    expect(h.associateFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-b", linkAcceptedAt: { not: null } } })
    );
  });

  it("values the company on its own accounts and adds up the user's blocks", async () => {
    h.associateFindMany.mockResolvedValue([row([400, 200], 0, [0, 0])]);
    const [share] = await loadCompanyShares("user-a", NOW);
    expect(share).toMatchObject({ companyId: "co-1", parts: 600, companyValueCents: BigInt(180_000_00), valueCents: BigInt(108_000_00) });
  });

  it("takes every current account off the company's value, then adds the user's own", async () => {
    // 180 000 on the bank, of which 50 000 is owed to associates (30 000 of
    // it to this one): ANR 130 000, 60 % of it 78 000, plus their 30 000.
    h.associateFindMany.mockResolvedValue([row([600], 30_000_00, [30_000_00, 20_000_00])]);
    const [share] = await loadCompanyShares("user-a", NOW);
    expect(share).toMatchObject({
      companyValueCents: BigInt(130_000_00),
      currentAccountCents: BigInt(30_000_00),
      valueCents: BigInt(78_000_00 + 30_000_00),
    });
  });
});

describe("computePortfolio", () => {
  it("adds the shareholder's shares to their own accounts", async () => {
    h.associateFindMany.mockResolvedValue([row([600], 0, [0])]);
    const { result } = await computePortfolio({ accountIds: ["perso"], shareholderId: "user-a", intlLocale: "fr-FR", now: NOW });
    expect(result.netWorth).toBe(BigInt(10_000_00 + 108_000_00));
  });

  it("loads no shares at all for a set that is not one person's", async () => {
    const { result } = await computePortfolio({ accountIds: ["sci-bank"], shareholderId: null, intlLocale: "fr-FR", now: NOW });
    expect(h.associateFindMany).not.toHaveBeenCalled();
    expect(result.netWorth).toBe(BigInt(180_000_00));
  });
});
