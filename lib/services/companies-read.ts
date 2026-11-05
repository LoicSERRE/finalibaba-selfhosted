import { prisma } from "@/lib/db/prisma";
import { companyAccountIds, companyRole, viewerCompanies, type CompanyRole } from "@/lib/auth-context";
import { computePortfolio } from "@/lib/services/net-worth";
import {
  fullStake,
  netAssetValueCents,
  partsInStake,
  stakeOfAssociate,
  stakeValueCents,
  weightedParts,
  type Stake,
} from "@/lib/domain/company";

/**
 * What the company screens read (dev-docs/companies.md, interface "C"). A
 * plain module that takes a userId, never a "use server" one: pages call it
 * with the viewer they resolved, and it re-checks the role itself.
 */

/** The cap table as stored: the company's terms, its associates, its blocks. */
async function loadCapTable(companyId: string) {
  return prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      kind: true,
      taxRegime: true,
      totalParts: true,
      discountPct: true,
      associates: {
        select: {
          id: true,
          name: true,
          userId: true,
          linkAcceptedAt: true,
          currentAccountCents: true,
          birthDate: true,
          user: { select: { username: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      holdings: { select: { parts: true, fullOwnerId: true, usufructuaryId: true, bareOwnerId: true } },
    },
  });
}
type CapTable = Awaited<ReturnType<typeof loadCapTable>>;

const birthDatesOf = (table: CapTable) => new Map(table.associates.map((a) => [a.id, a.birthDate]));

/**
 * What this user holds in the company through an ACCEPTED link - the same
 * rule as their net worth: their stake (full, usufruct, bare) and their
 * current account.
 */
function viewerStake(table: CapTable, userId: string): { stake: Stake; currentAccountCents: bigint } {
  const row = table.associates.find((a) => a.userId === userId && a.linkAcceptedAt !== null);
  if (!row) return { stake: fullStake(0), currentAccountCents: BigInt(0) };
  return { stake: stakeOfAssociate(row.id, table.holdings, birthDatesOf(table)), currentAccountCents: row.currentAccountCents };
}

/**
 * The company's own figures over its own accounts, and its net asset value:
 * those figures minus what it owes its associates on their current accounts.
 */
async function companyValue(companyId: string, intlLocale: string, now: Date) {
  const [accountIds, currentAccounts] = await Promise.all([
    companyAccountIds(companyId),
    prisma.companyAssociate.aggregate({ where: { companyId }, _sum: { currentAccountCents: true } }),
  ]);
  const { result } = await computePortfolio({ accountIds, shareholderId: null, intlLocale, now });
  const currentAccountsCents = currentAccounts._sum.currentAccountCents ?? BigInt(0);
  return { accountIds, result, currentAccountsCents, anrCents: netAssetValueCents(result.netWorth, currentAccountsCents) };
}

export interface CompanyCard {
  id: string;
  name: string;
  role: CompanyRole;
  partsHeld: number;
  totalParts: number;
  /** The viewer's economic weight in the company today, 0-1: an usufruct
   *  counts at its scale value, not as the whole block. */
  weight: number;
  /** The company's net asset value (current accounts deducted). */
  valueCents: bigint;
  /** Its worth to the viewer: their share of that value plus their current account. */
  shareCents: bigint;
  /** The viewer's current account, included in shareCents. */
  currentAccountCents: bigint;
}

/** One card per company on the Accounts page: its value and the viewer's share. */
export async function loadCompanyCards(userId: string, now: Date): Promise<CompanyCard[]> {
  const companies = await viewerCompanies(userId);
  return Promise.all(
    companies.map(async (c) => {
      const [table, value] = await Promise.all([loadCapTable(c.id), companyValue(c.id, "en-US", now)]);
      const { stake, currentAccountCents } = viewerStake(table, userId);
      return {
        id: c.id,
        name: c.name,
        role: c.role,
        partsHeld: partsInStake(stake),
        totalParts: table.totalParts,
        weight: weightedParts(stake, now).div(table.totalParts).toNumber(),
        valueCents: value.anrCents,
        shareCents: stakeValueCents(value.anrCents, stake, table.totalParts, table.discountPct, now) + currentAccountCents,
        currentAccountCents,
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
  /** Their current account, in cents. Every associate sees every one, as in
   *  the company's own books (a family's choice, dev-docs/companies.md). */
  currentAccountCents: number;
  /** Parts held as usufructuary and as bare owner (step 3); `parts` above is
   *  full ownership only. */
  usufructParts: number;
  bareParts: number;
  /** Their weight in the company today, 0-1 - what the parts bar draws. */
  weight: number;
  /** "YYYY-MM-DD", for the manager's editor only - like the usernames. */
  birthDate: string | null;
}

/** A démembrement block, for the manager's editor. */
export interface CompanyPageDismemberment {
  parts: number;
  usufructuaryId: string;
  bareOwnerId: string;
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

  const [table, value] = await Promise.all([loadCapTable(companyId), companyValue(companyId, intlLocale, now)]);
  const { id, name, kind, taxRegime, totalParts, discountPct } = table;
  const company = { id, name, kind, taxRegime, totalParts, discountPct };
  const viewer = viewerStake(table, userId);
  const birthDates = birthDatesOf(table);

  const rows: CompanyPageAssociate[] = table.associates.map((a) => {
    const stake = stakeOfAssociate(a.id, table.holdings, birthDates);
    return {
      id: a.id,
      name: a.name,
      parts: stake.fullParts,
      usufructParts: stake.usufructs.reduce((s, u) => s + u.parts, 0),
      bareParts: stake.bareOwnerships.reduce((s, b) => s + b.parts, 0),
      weight: weightedParts(stake, now).div(totalParts).toNumber(),
      isViewer: a.userId === userId,
      link: a.userId ? (a.linkAcceptedAt ? "accepted" : "pending") : null,
      username: isManager ? (a.user?.username ?? null) : null,
      currentAccountCents: Number(a.currentAccountCents),
      birthDate: isManager && a.birthDate ? a.birthDate.toISOString().slice(0, 10) : null,
    };
  });
  const dismemberments: CompanyPageDismemberment[] = table.holdings.flatMap((h) =>
    h.usufructuaryId && h.bareOwnerId ? [{ parts: h.parts, usufructuaryId: h.usufructuaryId, bareOwnerId: h.bareOwnerId }] : [],
  );

  return {
    company,
    role,
    associates: rows,
    dismemberments: isManager ? dismemberments : [],
    partsHeld: partsInStake(viewer.stake),
    viewerWeight: weightedParts(viewer.stake, now).div(totalParts).toNumber(),
    anrCents: value.anrCents,
    currentAccountsCents: value.currentAccountsCents,
    ownCurrentAccountCents: viewer.currentAccountCents,
    // A part before the discount, and after it when there is one.
    partValueCents: stakeValueCents(value.anrCents, fullStake(1), totalParts, null, now),
    discountedPartValueCents: discountPct ? stakeValueCents(value.anrCents, fullStake(1), totalParts, discountPct, now) : null,
    shareCents: stakeValueCents(value.anrCents, viewer.stake, totalParts, discountPct, now),
    result: value.result,
    // The net asset value per day: the accounts' history less today's current
    // accounts, so the curve ends on the figure above it.
    anrHistory: value.result.history.map((p) => ({ ...p, netWorth: p.netWorth - Number(value.currentAccountsCents) })),
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
    cards: cards.map((c) => ({
      ...c,
      valueCents: Number(c.valueCents),
      shareCents: Number(c.shareCents),
      currentAccountCents: Number(c.currentAccountCents),
    })),
    pending,
    attachable,
    scopedName: null,
  };
}
