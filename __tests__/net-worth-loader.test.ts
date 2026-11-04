import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/services/net-worth.ts: where a person's company shares are loaded. Two
// properties a mocked dashboard cannot show: only an ACCEPTED link counts,
// and a company is valued on its own accounts, then reduced to the share.

const h = vi.hoisted(() => ({
  holdingFindMany: vi.fn(),
  accountFindMany: vi.fn(),
  balanceFindMany: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    companyHolding: { findMany: h.holdingFindMany },
    account: { findMany: h.accountFindMany },
    historicalBalance: { findMany: h.balanceFindMany },
  },
}));

const { computePortfolio, loadCompanyShares } = await import("@/lib/services/net-worth");

const NOW = new Date("2026-07-28T12:00:00Z");
const SCI = { id: "co-1", name: "SCI", totalParts: 1000 };

function cash(id: string, cents: number) {
  return {
    id, name: id, type: "CHECKING", institutionId: null, institution: null, taxTreatment: "TAXABLE",
    taxRatePct: null, manualValueCents: null, liabilityCents: null, loanAmountCents: null, loanTaeg: null,
    loanDurationMonths: null, loanDeferralMonths: null, loanStartDate: null, holdings: [],
    history: [{ balanceCents: BigInt(cents) }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.balanceFindMany.mockResolvedValue([]);
  h.accountFindMany.mockImplementation(async ({ where, select }: { where: { companyId?: string; id?: { in: string[] } }; select?: unknown }) => {
    if (select) return where.companyId === SCI.id ? [{ id: "sci-bank" }] : [];
    return (where.id?.in ?? []).map((id) => cash(id, id === "sci-bank" ? 180_000_00 : 10_000_00));
  });
});

describe("loadCompanyShares", () => {
  it("only reads holdings whose link the user accepted", async () => {
    h.holdingFindMany.mockResolvedValue([]);
    await loadCompanyShares("user-b", NOW);
    expect(h.holdingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { fullOwner: { userId: "user-b", linkAcceptedAt: { not: null } } } })
    );
  });

  it("values the company on its own accounts and adds up the user's blocks", async () => {
    h.holdingFindMany.mockResolvedValue([
      { parts: 400, company: SCI },
      { parts: 200, company: SCI },
    ]);
    const [share] = await loadCompanyShares("user-a", NOW);
    expect(share).toMatchObject({ companyId: "co-1", parts: 600, companyValueCents: BigInt(180_000_00), valueCents: BigInt(108_000_00) });
  });
});

describe("computePortfolio", () => {
  it("adds the shareholder's shares to their own accounts", async () => {
    h.holdingFindMany.mockResolvedValue([{ parts: 600, company: SCI }]);
    const { result } = await computePortfolio({ accountIds: ["perso"], shareholderId: "user-a", intlLocale: "fr-FR", now: NOW });
    expect(result.netWorth).toBe(BigInt(10_000_00 + 108_000_00));
  });

  it("loads no shares at all for a set that is not one person's", async () => {
    const { result } = await computePortfolio({ accountIds: ["sci-bank"], shareholderId: null, intlLocale: "fr-FR", now: NOW });
    expect(h.holdingFindMany).not.toHaveBeenCalled();
    expect(result.netWorth).toBe(BigInt(180_000_00));
  });
});
