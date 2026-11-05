import { prisma } from "@/lib/db/prisma";
import { computeDashboard } from "@/lib/domain/dashboard";
import { buildCompanyShare, companyValueForRegime, stakeTimeline, type CompanyShare } from "@/lib/domain/company";

/**
 * The one loader behind every net worth the app shows or sends: the
 * dashboard, a share link, the REST API, the net-worth alert. Each used to
 * run its own copy of these two queries, which is how a figure changes in one
 * place and not the others - and with companies, a consumer that forgot the
 * share would count a person's SCI at nothing.
 *
 * `__tests__/net-worth-consumers.test.ts` fails if computeDashboard is called
 * from anywhere else.
 */

// Only what computeDashboard reads. `institution: true` (as some callers had)
// also pulled every stored credential column into memory for no reason.
const ACCOUNT_INCLUDE = {
  institution: { select: { id: true, name: true, logoUrl: true } },
  holdings: true,
  history: { orderBy: [{ recordedAt: "desc" as const }, { id: "desc" as const }], take: 1 },
};

export async function loadDashboardInput(accountIds: string[]) {
  const [accounts, allBalances] = await Promise.all([
    prisma.account.findMany({ where: { id: { in: accountIds } }, include: ACCOUNT_INCLUDE, orderBy: { name: "asc" } }),
    prisma.historicalBalance.findMany({ where: { accountId: { in: accountIds } }, orderBy: { recordedAt: "asc" } }),
  ]);
  return { accounts, allBalances };
}

/**
 * The companies this user holds parts in, each valued through computeDashboard
 * over the company's own accounts (dev-docs/companies.md, principle 5) and
 * reduced to the user's share. Only an ACCEPTED link counts: until the user
 * agrees to be linked to an associate, the company is nothing to them.
 */
export async function loadCompanyShares(userId: string, now: Date): Promise<CompanyShare[]> {
  // The user's own associate rows - one per company, by the (companyId,
  // userId) unique index - with their parts and current account, plus every
  // current account of the company: together they owe that much, which comes
  // off the company's value before anyone's share is taken.
  const rows = await prisma.companyAssociate.findMany({
    where: { userId, linkAcceptedAt: { not: null } },
    select: {
      id: true,
      currentAccountCents: true,
      company: {
        select: {
          id: true,
          name: true,
          totalParts: true,
          discountPct: true,
          taxRegime: true,
          associates: { select: { id: true, currentAccountCents: true, birthDate: true } },
          // Every dated cap table (step 5): a past day is valued with the
          // parts held that day.
          versions: {
            select: {
              effectiveFrom: true,
              totalParts: true,
              holdings: { select: { parts: true, fullOwnerId: true, usufructuaryId: true, bareOwnerId: true } },
            },
            orderBy: { effectiveFrom: "asc" },
          },
        },
      },
    },
  });

  return Promise.all(
    rows.map(async ({ id: associateId, company, currentAccountCents }) => {
      const ids = (await prisma.account.findMany({ where: { companyId: company.id }, select: { id: true } })).map((a) => a.id);
      const input = await loadDashboardInput(ids);
      const raw = computeDashboard({ ...input, intlLocale: "en-US", now });
      // Its regime decides the latent tax: IS takes corporate tax on the whole
      // latent gain, buildings included (step 4). Today's adjustment is applied
      // to every past day, like the current accounts.
      const value = companyValueForRegime(raw, company.taxRegime, input.accounts);
      // Full ownership, usufruct and bare ownership alike, version by version:
      // the stake carries the birth dates its value depends on (art. 669 I
      // CGI). Someone who ceded everything is worth 0 from that day on, and
      // still their parts before it.
      const stake = stakeTimeline(associateId, company.versions, new Map(company.associates.map((a) => [a.id, a.birthDate])));
      const totalCents = company.associates.reduce((sum, a) => sum + a.currentAccountCents, BigInt(0));
      return buildCompanyShare(company, stake, value.netWorth, value.history, { totalCents, ownCents: currentAccountCents }, now);
    }),
  );
}

/**
 * A portfolio's figures. `shareholderId` is the person whose company shares
 * belong in it - the portfolio's owner - and null for a set that is not one
 * person's (a company's own scope: companies never hold companies here).
 */
export async function computePortfolio(opts: {
  accountIds: string[];
  shareholderId: string | null;
  intlLocale: string;
  now: Date;
}) {
  const [data, companyShares] = await Promise.all([
    loadDashboardInput(opts.accountIds),
    opts.shareholderId ? loadCompanyShares(opts.shareholderId, opts.now) : Promise.resolve([]),
  ]);
  const input = { ...data, companyShares };
  // The loaded rows ride along: a share link lists its holdings from them.
  return { input, result: computeDashboard({ ...input, intlLocale: opts.intlLocale, now: opts.now }) };
}
