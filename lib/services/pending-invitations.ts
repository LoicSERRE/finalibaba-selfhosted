import { prisma } from "@/lib/db/prisma";

/**
 * How many invitations are waiting on this user's answer, by where they are
 * answered: shares (a co-owned account, a portfolio grant - Settings ->
 * Partage) and company links (the Accounts page). The same conditions as
 * listPendingShares and loadPendingCompanyLinks, counted rather than loaded.
 */
export async function countPendingInvitations(userId: string): Promise<{ shares: number; companies: number }> {
  const [coOwnerships, grants, companies] = await Promise.all([
    prisma.accountCoOwner.count({ where: { userId, acceptedAt: null } }),
    prisma.portfolioGrant.count({ where: { granteeUserId: userId, acceptedAt: null } }),
    prisma.companyAssociate.count({ where: { userId, linkAcceptedAt: null } }),
  ]);
  return { shares: coOwnerships + grants, companies };
}
