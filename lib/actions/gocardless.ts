"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getAccountBalances, getTransactions, pickBalance, type GCTransaction } from "@/lib/services/gocardless";
import { autoCategorizeTransactions } from "@/lib/actions/auto-categorize";

/** Refresh balances for all GoCardless-linked accounts of an institution */
export async function syncGocardlessBalances(institutionId: string) {
  const accounts = await prisma.account.findMany({
    where: { institutionId, gocardlessAccountId: { not: null } },
  });

  if (accounts.length === 0) throw new Error("No GoCardless account linked to this institution");

  await Promise.all(
    accounts.map(async (account) => {
      const { balances } = await getAccountBalances(account.gocardlessAccountId!);
      const balanceCents = pickBalance(balances);
      await prisma.historicalBalance.create({
        data: { accountId: account.id, balanceCents },
      });
    })
  );

  revalidatePath("/accounts");
  revalidatePath("/settings");
  revalidatePath("/");
}

// Only `booked` transactions - `pending` ones routinely lack a stable
// `transactionId` (see GCTransaction in lib/services/gocardless.ts), which
// this dedup scheme needs. A pending transaction becomes syncable once the
// bank moves it to `booked` on a later sync, same as it would show up late
// in the bank's own app.
function gcTransactionToRow(accountId: string, tx: GCTransaction) {
  if (!tx.transactionId) return null;
  const dateStr = tx.bookingDate ?? tx.valueDate;
  if (!dateStr) return null;

  const label = tx.remittanceInformationUnstructured || tx.creditorName || tx.debtorName || "—";
  return {
    accountId,
    syncId: `gocardless_${tx.transactionId}`,
    // Noon UTC, same convention as CSV import and every other Transaction
    // writer in this app - avoids a midnight-UTC day shift in
    // negative-offset timezones.
    date: new Date(`${dateStr}T12:00:00.000Z`),
    label: label.slice(0, 500),
    amountCents: BigInt(Math.round(Number.parseFloat(tx.transactionAmount.amount) * 100)),
    merchantCategoryCode: tx.merchantCategoryCode ?? null,
  };
}

/**
 * Fetches and stores transactions for all GoCardless-linked accounts of an
 * institution - this app's only source of GoCardless `Transaction` rows,
 * previously nonexistent (GoCardless accounts only ever got a
 * HistoricalBalance via syncGocardlessBalances above, never individual
 * transactions the way Woob/Trade Republic already do via sync/db.py's
 * upsert_transaction). `createMany` with `skipDuplicates` rather than a
 * per-row upsert - transactions are immutable once synced here, so there's
 * never a need to update an already-known row, only insert new ones.
 * Auto-categorization runs immediately after (see
 * lib/actions/auto-categorize.ts) so a freshly-synced transaction with a
 * populated merchantCategoryCode gets a chance to land in a category in
 * the very same sync, not a cycle behind.
 */
export async function syncGocardlessTransactions(institutionId: string) {
  const accounts = await prisma.account.findMany({
    where: { institutionId, gocardlessAccountId: { not: null } },
  });

  if (accounts.length === 0) return { imported: 0 };

  let imported = 0;
  for (const account of accounts) {
    const { transactions } = await getTransactions(account.gocardlessAccountId!);
    const rows = transactions.booked
      .map((tx) => gcTransactionToRow(account.id, tx))
      .filter((row) => row !== null);
    if (rows.length === 0) continue;
    const result = await prisma.transaction.createMany({ data: rows, skipDuplicates: true });
    imported += result.count;
  }

  await autoCategorizeTransactions();

  revalidatePath("/accounts");
  revalidatePath("/budgets");
  revalidatePath("/");

  return { imported };
}

/** Combines both GoCardless syncs behind the one "Sync" button - separate
 * rate-limit quotas per endpoint (see getTransactions), so doing both on
 * every click doesn't cost either one anything. */
export async function syncGocardlessAccount(institutionId: string) {
  await syncGocardlessBalances(institutionId);
  return syncGocardlessTransactions(institutionId);
}
