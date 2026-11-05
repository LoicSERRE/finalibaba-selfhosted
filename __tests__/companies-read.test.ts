import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/services/companies-read.ts, what the company screens read. The role is
// re-checked here, not trusted from the page: an outsider gets nothing, and
// an associate never receives what only the manager's tools need (the
// linked usernames, what can be attached).

const h = vi.hoisted(() => ({
  role: null as "manager" | "associate" | null,
  associateAggregate: vi.fn(),
  associateFindMany: vi.fn(),
  companyFindUniqueOrThrow: vi.fn(),
  accountFindMany: vi.fn(),
  institutionFindMany: vi.fn(),
  computePortfolio: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    companyAssociate: { findMany: h.associateFindMany, aggregate: h.associateAggregate },
    company: { findUniqueOrThrow: h.companyFindUniqueOrThrow },
    account: { findMany: h.accountFindMany },
    institution: { findMany: h.institutionFindMany },
  },
}));

vi.mock("@/lib/auth-context", () => ({
  companyRole: async () => h.role,
  companyAccountIds: async () => ["sci-bank"],
  currentCapTableVersionId: async () => "v-current",
  viewerCompanies: async () => [],
}));

vi.mock("@/lib/services/net-worth", () => ({ computePortfolio: h.computePortfolio }));

const { loadCompanyPage, loadPendingCompanyLinks } = await import("@/lib/services/companies-read");

const COMPANY = "ckcompany00000000000000001";

type HoldingFixture = { parts: number; fullOwnerId: string | null; usufructuaryId: string | null; bareOwnerId: string | null };
let versionSeq = 0;
/** A dated cap table (step 5); the default is the only one, from long ago. */
function version(totalParts: number, holdings: HoldingFixture[], from = "2020-01-01", kind = "CREATION") {
  versionSeq += 1;
  return { id: `v${versionSeq}`, effectiveFrom: new Date(`${from}T00:00:00Z`), totalParts, kind, holdings };
}
const NOW = new Date("2026-11-05T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  // The cap table in one read: Camille 600 parts, Marie 400, 50 000 of
  // current accounts between them.
  h.companyFindUniqueOrThrow.mockResolvedValue({
    id: COMPANY, name: "SCI", kind: "SCI", taxRegime: "IR", totalParts: 1000, discountPct: null,
    associates: [
      { id: "a1", name: "Camille", userId: "user-a", linkAcceptedAt: new Date(), currentAccountCents: BigInt(30_000_00), birthDate: new Date("1980-05-01T00:00:00Z"), user: { username: "camille" } },
      { id: "a2", name: "Marie", userId: "user-b", linkAcceptedAt: new Date(), currentAccountCents: BigInt(20_000_00), birthDate: null, user: { username: "marie" } },
    ],
    versions: [version(1000, [
      { parts: 600, fullOwnerId: "a1", usufructuaryId: null, bareOwnerId: null },
      { parts: 400, fullOwnerId: "a2", usufructuaryId: null, bareOwnerId: null },
    ])],
  });
  h.associateAggregate.mockResolvedValue({ _sum: { currentAccountCents: BigInt(50_000_00) } });
  h.accountFindMany.mockResolvedValue([]);
  h.institutionFindMany.mockResolvedValue([]);
  h.computePortfolio.mockResolvedValue({
    input: { accounts: [] },
    result: { netWorth: BigInt(180_000_00), totalLatentTax: BigInt(0), investmentGainCents: BigInt(0), history: [], institutions: [], allocationRaw: {} },
  });
});

describe("loadCompanyPage", () => {
  it("gives an outsider nothing, and reads nothing for them", async () => {
    h.role = null;
    await expect(loadCompanyPage("user-z", COMPANY, "fr-FR", NOW)).resolves.toBeNull();
    expect(h.companyFindUniqueOrThrow).not.toHaveBeenCalled();
    expect(h.computePortfolio).not.toHaveBeenCalled();
  });

  it("gives an associate the cap table without usernames or the manager's tools", async () => {
    h.role = "associate";
    const page = await loadCompanyPage("user-b", COMPANY, "fr-FR", NOW);
    expect(page?.associates.map((a) => a.username)).toEqual([null, null]);
    // Birth dates are the manager's to see, like the usernames.
    expect(page?.associates.map((a) => a.birthDate)).toEqual([null, null]);
    expect(page?.attachable).toBeNull();
    expect(page?.associates.find((a) => a.isViewer)?.name).toBe("Marie");
    expect(page?.anrCents).toBe(BigInt(130_000_00));
    expect(page?.shareCents).toBe(BigInt(52_000_00));
    expect(page?.ownCurrentAccountCents).toBe(BigInt(20_000_00));
    expect(page?.partValueCents).toBe(BigInt(130_00));
    // Every associate's current account, to every associate (as in the books).
    expect(page?.associates.map((a) => a.currentAccountCents)).toEqual([30_000_00, 20_000_00]);
  });

  it("gives the manager the usernames and what can be attached", async () => {
    h.role = "manager";
    const page = await loadCompanyPage("user-a", COMPANY, "fr-FR", NOW);
    expect(page?.associates.map((a) => a.username)).toEqual(["camille", "marie"]);
    expect(page?.associates[0].birthDate).toBe("1980-05-01");
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

describe("démembrement on the company page (step 3)", () => {
  it("shows an usufructuary's economic weight, not the parts they have a right on", async () => {
    h.role = "associate";
    h.associateAggregate.mockResolvedValue({ _sum: { currentAccountCents: BigInt(0) } });
    h.companyFindUniqueOrThrow.mockResolvedValue({
      id: COMPANY, name: "SCI", kind: "SCI", taxRegime: "IR", totalParts: 1000, discountPct: null,
      associates: [
        { id: "p", name: "Parent", userId: "user-b", linkAcceptedAt: new Date(), currentAccountCents: BigInt(0), birthDate: new Date("1956-01-01T00:00:00Z"), user: null },
        { id: "c", name: "Enfant", userId: null, linkAcceptedAt: null, currentAccountCents: BigInt(0), birthDate: null, user: null },
      ],
      versions: [version(1000, [{ parts: 1000, fullOwnerId: null, usufructuaryId: "p", bareOwnerId: "c" }])],
    });
    const page = await loadCompanyPage("user-b", COMPANY, "fr-FR", NOW); // parent is 70: 40 / 60
    expect(page?.partsHeld).toBe(1000);
    expect(page?.viewerWeight).toBeCloseTo(0.4, 10);
    expect(page?.shareCents).toBe(BigInt(72_000_00)); // 40 % of 180 000
    expect(page?.associates.map((a) => [a.usufructParts, a.bareParts])).toEqual([[1000, 0], [0, 1000]]);
    // The blocks are the manager's editor's: an associate gets none.
    expect(page?.dismemberments).toEqual([]);
  });
});

describe("dated cap tables on the company page (step 5)", () => {
  beforeEach(() => {
    h.role = "manager";
    // Marie ceded her 400 parts to Léo on 2025-03-01; she is in the old version only.
    h.companyFindUniqueOrThrow.mockResolvedValue({
      id: COMPANY, name: "SCI", kind: "SCI", taxRegime: "IR", totalParts: 1000, discountPct: null,
      associates: [
        { id: "a1", name: "Camille", userId: "user-a", linkAcceptedAt: new Date(), currentAccountCents: BigInt(0), birthDate: null, user: null },
        { id: "a2", name: "Marie", userId: "user-b", linkAcceptedAt: new Date(), currentAccountCents: BigInt(0), birthDate: null, user: null },
        { id: "a3", name: "Léo", userId: null, linkAcceptedAt: null, currentAccountCents: BigInt(0), birthDate: null, user: null },
      ],
      versions: [
        version(1000, [
          { parts: 600, fullOwnerId: "a1", usufructuaryId: null, bareOwnerId: null },
          { parts: 400, fullOwnerId: "a2", usufructuaryId: null, bareOwnerId: null },
        ], "2024-01-01"),
        version(1000, [
          { parts: 600, fullOwnerId: "a1", usufructuaryId: null, bareOwnerId: null },
          { parts: 400, fullOwnerId: "a3", usufructuaryId: null, bareOwnerId: null },
        ], "2025-03-01", "CESSION"),
      ],
    });
    h.associateAggregate.mockResolvedValue({ _sum: { currentAccountCents: BigInt(0) } });
  });

  it("shows the cap table in force today, without who has left", async () => {
    const page = await loadCompanyPage("user-a", COMPANY, "fr-FR", NOW);
    expect(page?.associates.map((a) => [a.name, a.parts])).toEqual([["Camille", 600], ["Léo", 400]]);
  });

  it("lists every version, newest first, with who held what", async () => {
    const page = await loadCompanyPage("user-a", COMPANY, "fr-FR", NOW);
    expect(page?.versions.map((v) => [v.effectiveFrom, v.kind, v.isCurrent])).toEqual([
      ["2025-03-01", "CESSION", true],
      ["2024-01-01", "CREATION", false],
    ]);
    expect(page?.versions[1].holders.map((x) => [x.name, x.parts])).toEqual([["Camille", 600], ["Marie", 400]]);
  });

  it("reads a version the day it started, and the first one for earlier days", async () => {
    const before = await loadCompanyPage("user-a", COMPANY, "fr-FR", new Date("2023-06-01T12:00:00Z"));
    expect(before?.associates.map((a) => a.name)).toEqual(["Camille", "Marie"]);
    const onTheDay = await loadCompanyPage("user-a", COMPANY, "fr-FR", new Date("2025-03-01T00:00:00Z"));
    expect(onTheDay?.associates.map((a) => a.name)).toEqual(["Camille", "Léo"]);
  });
});

describe("pending links (step 5)", () => {
  it("count the parts today's cap table gives, not every version's", async () => {
    h.associateFindMany.mockResolvedValue([
      {
        id: "a3",
        companyId: COMPANY,
        holdings: [{ parts: 100, versionId: "v-old" }, { parts: 400, versionId: "v-current" }],
        company: { name: "SCI", totalParts: 1000, manager: { displayName: null, username: "camille" } },
      },
    ]);
    const [link] = await loadPendingCompanyLinks("user-c");
    expect(link.parts).toBe(400);
  });
});
