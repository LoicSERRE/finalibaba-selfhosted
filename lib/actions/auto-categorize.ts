"use server";

import { revalidateTransactions } from "@/lib/actions/revalidate";
import { getViewer, baseAccountIds } from "@/lib/auth-context";
import { autoCategorizeForUser } from "@/lib/services/auto-categorize-runner";

// Session-resolving wrappers around lib/services/auto-categorize-runner.ts.
// The engine itself lives there rather than here precisely because it needs
// a userId parameter, and every export of a "use server" module is directly
// invocable from the browser with attacker-chosen arguments - see that
// file's own header.
//
// `baseAccountIds` (own + co-owned), not `viewAccountIds`: categorization
// writes, so a read-only guest viewing someone else's portfolio must never
// have their pass reach into it.

export async function autoCategorizeTransactions(accountId?: string): Promise<{ categorized: number }> {
  const viewer = await getViewer();
  const accountIds = await baseAccountIds(viewer.id);
  return autoCategorizeForUser(viewer.id, accountIds, accountId);
}

export async function runAutoCategorizeNow() {
  const result = await autoCategorizeTransactions();
  revalidateTransactions();
  return result;
}
