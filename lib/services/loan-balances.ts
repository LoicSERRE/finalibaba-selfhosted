import type { Prisma } from "@/app/generated/prisma/client";

/**
 * Stores an account's balance rows as what is owed (sign -1) or as what is
 * held (sign 1) - a bank-reported loan's rows are negative (sync/sync_woob.py),
 * so an account crossing that line has its history follow (v2.22).
 */
export async function setBalanceSigns(tx: Prisma.TransactionClient, accountId: string, sign: 1 | -1): Promise<void> {
  await tx.$executeRaw`
    UPDATE "HistoricalBalance"
    SET "balanceCents" = ${sign} * ABS("balanceCents"), "nativeBalanceCents" = ${sign} * ABS("nativeBalanceCents")
    WHERE "accountId" = ${accountId}`;
}
