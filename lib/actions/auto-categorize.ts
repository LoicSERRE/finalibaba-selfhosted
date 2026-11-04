"use server";

import { revalidateTransactions } from "@/lib/actions/revalidate";
import { getViewer, accountPools } from "@/lib/auth-context";
import { autoCategorizeForUser } from "@/lib/services/auto-categorize-runner";

// Session-resolving wrappers around lib/services/auto-categorize-runner.ts.
// The engine itself lives there rather than here precisely because it needs
// a userId parameter, and every export of a "use server" module is directly
// invocable from the browser with attacker-chosen arguments - see that
// file's own header.
//
// `accountPools` (own + co-owned, then each managed company), never
// `viewAccountIds`: categorization writes, so a read-only guest viewing
// someone else's portfolio must never have their pass reach into it. One
// pass per pool, so a transfer between a person and their company is never
// paired as internal (accountPools).

export async function autoCategorizeTransactions(accountId?: string): Promise<{ categorized: number }> {
  const viewer = await getViewer();
  const pools = await accountPools(viewer.id);
  const selected = accountId ? pools.filter((pool) => pool.includes(accountId)) : pools;
  let categorized = 0;
  for (const pool of selected) categorized += (await autoCategorizeForUser(viewer.id, pool, accountId)).categorized;
  return { categorized };
}

export async function runAutoCategorizeNow() {
  const result = await autoCategorizeTransactions();
  revalidateTransactions();
  return result;
}
