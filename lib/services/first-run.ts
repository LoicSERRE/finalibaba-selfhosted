import { prisma } from "@/lib/db/prisma";
import { UNTOUCHED_LEGACY_GOAL, type FirstRunFacts } from "@/lib/domain/first-run";

/**
 * What the first-run checklist is ticked from (v2.17), for one user: their
 * own and co-owned accounts (the caller passes baseAccountIds), their
 * categories, goals and financial profile.
 */
export async function loadFirstRunFacts(userId: string, accountIds: string[]): Promise<FirstRunFacts> {
  const [accounts, syncedAccounts, settings, categories, goals] = await Promise.all([
    prisma.account.count({ where: { id: { in: accountIds } } }),
    prisma.account.count({
      where: { id: { in: accountIds }, OR: [{ syncId: { not: null } }, { gocardlessAccountId: { not: null } }] },
    }),
    prisma.userSettings.findUnique({ where: { userId }, select: { country: true, salaryNetCents: true } }),
    prisma.category.count({ where: { userId } }),
    prisma.goal.count({ where: { userId, NOT: UNTOUCHED_LEGACY_GOAL } }),
  ]);
  const profileSet = Boolean(settings && (settings.country !== null || settings.salaryNetCents > BigInt(0)));
  return { accounts, syncedAccounts, profileSet, categories, goals };
}
