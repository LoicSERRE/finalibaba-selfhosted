import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/services/companies-read.ts, what the company screens read. The role is
// re-checked here, not trusted from the page: an outsider gets nothing, and
// an associate never receives what only the manager's tools need (the
// linked usernames, what can be attached).

const h = vi.hoisted(() => ({
  role: null as "manager" | "associate" | null,
  holdingFindMany: vi.fn(),
  associateFindMany: vi.fn(),
  companyFindUniqueOrThrow: vi.fn(),
  accountFindMany: vi.fn(),
  institutionFindMany: vi.fn(),
  computePortfolio: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    companyHolding: { findMany: h.holdingFindMany },
    companyAssociate: { findMany: h.associateFindMany },
    company: { findUniqueOrThrow: h.companyFindUniqueOrThrow },
    account: { findMany: h.accountFindMany },
    institution: { findMany: h.institutionFindMany },
  },
}));

vi.mock("@/lib/auth-context", () => ({
  companyRole: async () => h.role,
  companyAccountIds: async () => ["sci-bank"],
  viewerCompanies: async () => [],
}));

vi.mock("@/lib/services/net-worth", () => ({ computePortfolio: h.computePortfolio }));

const { loadCompanyPage, loadPendingCompanyLinks } = await import("@/lib/services/companies-read");

const COMPANY = "ckcompany00000000000000001";
const NOW = new Date("2026-11-05T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  h.companyFindUniqueOrThrow.mockResolvedValue({ id: COMPANY, name: "SCI", kind: "SCI", taxRegime: "IR", totalParts: 1000 });
  h.associateFindMany.mockResolvedValue([
    { id: "a1", name: "Camille", userId: "user-a", linkAcceptedAt: new Date(), user: { username: "camille" }, holdings: [{ parts: 600 }] },
    { id: "a2", name: "Marie", userId: "user-b", linkAcceptedAt: new Date(), user: { username: "marie" }, holdings: [{ parts: 400 }] },
  ]);
  h.holdingFindMany.mockResolvedValue([{ parts: 400 }]);
  h.accountFindMany.mockResolvedValue([]);
  h.institutionFindMany.mockResolvedValue([]);
  h.computePortfolio.mockResolvedValue({ result: { netWorth: BigInt(180_000_00), history: [], institutions: [], allocationRaw: {} } });
});

describe("loadCompanyPage", () => {
  it("gives an outsider nothing, and reads nothing for them", async () => {
    h.role = null;
    await expect(loadCompanyPage("user-z", COMPANY, "fr-FR", NOW)).resolves.toBeNull();
    expect(h.associateFindMany).not.toHaveBeenCalled();
    expect(h.computePortfolio).not.toHaveBeenCalled();
  });

  it("gives an associate the cap table without usernames or the manager's tools", async () => {
    h.role = "associate";
    const page = await loadCompanyPage("user-b", COMPANY, "fr-FR", NOW);
    expect(page?.associates.map((a) => a.username)).toEqual([null, null]);
    expect(page?.attachable).toBeNull();
    expect(page?.associates.find((a) => a.isViewer)?.name).toBe("Marie");
    // Their share, from their ACCEPTED holdings only.
    expect(h.holdingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: COMPANY, fullOwner: { userId: "user-b", linkAcceptedAt: { not: null } } } })
    );
    expect(page?.shareCents).toBe(BigInt(72_000_00));
    expect(page?.partValueCents).toBe(BigInt(180_00));
  });

  it("gives the manager the usernames and what can be attached", async () => {
    h.role = "manager";
    const page = await loadCompanyPage("user-a", COMPANY, "fr-FR", NOW);
    expect(page?.associates.map((a) => a.username)).toEqual(["camille", "marie"]);
    expect(page?.attachable).not.toBeNull();
    // Only the manager's own, company-less, non-co-owned manual accounts.
    expect(h.accountFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-a", companyId: null, institutionId: null, coOwners: { none: {} } } })
    );
  });

  it("values the company on its own accounts, never with anyone's shares", async () => {
    h.role = "manager";
    await loadCompanyPage("user-a", COMPANY, "fr-FR", NOW);
    expect(h.computePortfolio).toHaveBeenCalledWith(expect.objectContaining({ accountIds: ["sci-bank"], shareholderId: null }));
  });
});

describe("loadPendingCompanyLinks", () => {
  it("lists only the viewer's own unanswered links", async () => {
    h.associateFindMany.mockResolvedValue([]);
    await loadPendingCompanyLinks("user-b");
    expect(h.associateFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-b", linkAcceptedAt: null } }));
  });
});
