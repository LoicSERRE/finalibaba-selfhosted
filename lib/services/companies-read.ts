import { prisma } from "@/lib/db/prisma";
import { companyAccountIds, companyRole, viewerCompanies, type CompanyRole } from "@/lib/auth-context";
import { computePortfolio } from "@/lib/services/net-worth";
import { shareCents } from "@/lib/domain/company";

/**
 * What the company screens read (dev-docs/companies.md, interface "C"). A
 * plain module that takes a userId, never a "use server" one: pages call it
 * with the viewer they resolved, and it re-checks the role itself.
 */

/** Parts this user holds through an ACCEPTED link - the same rule as their net worth. */
async function partsHeld(userId: string, companyId: string): Promise<number> {
  const rows = await prisma.companyHolding.findMany({
    where: { companyId, fullOwner: { userId, linkAcceptedAt: { not: null } } },
    select: { parts: true },
  });
  return rows.reduce((sum, r) => sum + r.parts, 0);
}

async function companyValue(companyId: string, intlLocale: string, now: Date) {
  const accountIds = await companyAccountIds(companyId);
  const { result } = await computePortfolio({ accountIds, shareholderId: null, intlLocale, now });
  return { accountIds, result };
}

export interface CompanyCard {
  id: string;
  name: string;
  role: CompanyRole;
  partsHeld: number;
  totalParts: number;
  valueCents: bigint;
  shareCents: bigint;
}

/** One card per company on the Accounts page: its value and the viewer's share. */
export async function loadCompanyCards(userId: string, now: Date): Promise<CompanyCard[]> {
  const companies = await viewerCompanies(userId);
  return Promise.all(
    companies.map(async (c) => {
      const [company, held, { result }] = await Promise.all([
        prisma.company.findUniqueOrThrow({ where: { id: c.id }, select: { totalParts: true } }),
        partsHeld(userId, c.id),
        companyValue(c.id, "en-US", now),
      ]);
      return {
        id: c.id,
        name: c.name,
        role: c.role,
        partsHeld: held,
        totalParts: company.totalParts,
        valueCents: result.netWorth,
        shareCents: shareCents(result.netWorth, held, company.totalParts),
      };
    }),
  );
}

export interface PendingCompanyLink {
  associateId: string;
  companyName: string;
  from: string | null;
  parts: number;
  totalParts: number;
}

/** Links to this user a manager made and they have not answered yet. */
export async function loadPendingCompanyLinks(userId: string): Promise<PendingCompanyLink[]> {
  const rows = await prisma.companyAssociate.findMany({
    where: { userId, linkAcceptedAt: null },
    select: {
      id: true,
      holdings: { select: { parts: true } },
      company: {
        select: { name: true, totalParts: true, manager: { select: { displayName: true, username: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    associateId: r.id,
    companyName: r.company.name,
    from: r.company.manager.displayName ?? r.company.manager.username,
    parts: r.holdings.reduce((sum, h) => sum + h.parts, 0),
    totalParts: r.company.totalParts,
  }));
}

export interface CompanyPageAssociate {
  id: string;
  name: string;
  parts: number;
  isViewer: boolean;
  /** "pending" while the linked user has not accepted; null for a bare name. */
  link: "accepted" | "pending" | null;
  /** The linked user's username - for the manager's editor only. */
  username: string | null;
}

/**
 * Everything the company page shows, or null when the viewer may not see it -
 * a missing company and somebody else's give the same null (notFound()).
 * Manager-only parts (usernames, what can be attached) are left out for an
 * associate rather than hidden in the UI.
 */
export async function loadCompanyPage(userId: string, companyId: string, intlLocale: string, now: Date) {
  const role = await companyRole(userId, companyId);
  if (!role) return null;
  const isManager = role === "manager";

  const [company, associates, held, value] = await Promise.all([
    prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { id: true, name: true, kind: true, taxRegime: true, totalParts: true },
    }),
    prisma.companyAssociate.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        userId: true,
        linkAcceptedAt: true,
        user: { select: { username: true } },
        holdings: { select: { parts: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    partsHeld(userId, companyId),
    companyValue(companyId, intlLocale, now),
  ]);

  const rows: CompanyPageAssociate[] = associates.map((a) => ({
    id: a.id,
    name: a.name,
    parts: a.holdings.reduce((sum, h) => sum + h.parts, 0),
    isViewer: a.userId === userId,
    link: a.userId ? (a.linkAcceptedAt ? "accepted" : "pending") : null,
    username: isManager ? (a.user?.username ?? null) : null,
  }));

  return {
    company,
    role,
    associates: rows,
    partsHeld: held,
    partValueCents: shareCents(value.result.netWorth, 1, company.totalParts),
    shareCents: shareCents(value.result.netWorth, held, company.totalParts),
    result: value.result,
    attachable: isManager ? await loadAttachable(userId, companyId) : null,
  };
}

/**
 * For the manager: what can move into this company - their own manual
 * accounts and bank connections that are in no company and not co-owned -
 * and what is in it and can move back out.
 */
const institutionRow = (i: { id: string; name: string; _count: { accounts: number } }) => ({
  id: i.id,
  name: i.name,
  accountCount: i._count.accounts,
});

/**
 * The user's own manual accounts and bank connections that could go into a
 * company: in none yet, and nothing co-owned (setAccountCompany and
 * setInstitutionCompany refuse those anyway). Also the creation guide's last step.
 */
export async function loadPersonalAttachable(userId: string) {
  const [accounts, institutions] = await Promise.all([
    prisma.account.findMany({
      where: { userId, companyId: null, institutionId: null, coOwners: { none: {} } },
      select: { id: true, name: true, type: true },
      orderBy: { name: "asc" },
    }),
    prisma.institution.findMany({
      where: { userId, companyId: null, accounts: { none: { coOwners: { some: {} } } } },
      select: { id: true, name: true, _count: { select: { accounts: true } } },
      orderBy: { name: "asc" },
    }),
  ]);
  return { accounts, institutions: institutions.map(institutionRow) };
}

async function loadAttachable(userId: string, companyId: string) {
  const [personal, companyAccounts, companyInstitutions] = await Promise.all([
    loadPersonalAttachable(userId),
    prisma.account.findMany({
      where: { companyId, institutionId: null },
      select: { id: true, name: true, type: true },
      orderBy: { name: "asc" },
    }),
    prisma.institution.findMany({
      where: { companyId },
      select: { id: true, name: true, _count: { select: { accounts: true } } },
      orderBy: { name: "asc" },
    }),
  ]);
  return {
    personalAccounts: personal.accounts,
    personalInstitutions: personal.institutions,
    companyAccounts,
    companyInstitutions: companyInstitutions.map(institutionRow),
  };
}

/**
 * What the Accounts page shows about companies, for the scope on screen: on
 * the viewer's own portfolio their cards, their pending links and what a new
 * company could take; in a company's scope only its name (for the banner);
 * on a granted portfolio nothing. BigInt turned into numbers for the client.
 */
export async function loadAccountsPageCompanies(userId: string, scope: { readOnly: boolean; companyId?: string }) {
  const none = { ownPortfolio: false, cards: [], pending: [], attachable: { accounts: [], institutions: [] }, scopedName: null };
  if (scope.companyId) {
    const company = await prisma.company.findUnique({ where: { id: scope.companyId }, select: { name: true } });
    return { ...none, scopedName: company?.name ?? null };
  }
  if (scope.readOnly) return none;
  const [cards, pending, attachable] = await Promise.all([
    loadCompanyCards(userId, new Date()),
    loadPendingCompanyLinks(userId),
    loadPersonalAttachable(userId),
  ]);
  return {
    ownPortfolio: true,
    cards: cards.map((c) => ({ ...c, valueCents: Number(c.valueCents), shareCents: Number(c.shareCents) })),
    pending,
    attachable,
    scopedName: null,
  };
}
