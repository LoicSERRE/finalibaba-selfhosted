"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAccountBalances, pickBalance } from "@/lib/gocardless";

/** Refresh balances for all GoCardless-linked accounts of an institution */
export async function syncGocardlessBalances(institutionId: string) {
  const accounts = await prisma.account.findMany({
    where: { institutionId, gocardlessAccountId: { not: null } },
  });

  if (accounts.length === 0) throw new Error("Aucun compte lié à GoCardless");

  await Promise.all(
    accounts.map(async (account) => {
      const { balances } = await getAccountBalances(account.gocardlessAccountId!);
      const balanceCents = pickBalance(balances);
      await prisma.historicalBalance.create({
        data: { accountId: account.id, balanceCents },
      });
    })
  );

  revalidatePath("/banks");
  revalidatePath("/");
}
