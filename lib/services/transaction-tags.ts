import { prisma } from "@/lib/db/prisma";

/**
 * Every tag in use on these accounts, sorted - for the ledger's tag filter
 * and the note dialog's suggestions (v2.14). A read for pages, so it takes
 * the account set the caller already resolved (view context for display).
 */
export async function listTags(accountIds: string[]): Promise<string[]> {
  if (accountIds.length === 0) return [];
  const rows = await prisma.$queryRaw<{ tag: string }[]>`
    SELECT DISTINCT unnest("tags") AS tag FROM "Transaction"
    WHERE "accountId" = ANY(${accountIds})
    ORDER BY tag`;
  return rows.map((row) => row.tag);
}
