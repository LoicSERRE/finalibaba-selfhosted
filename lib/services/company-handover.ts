import type { prisma } from "@/lib/db/prisma";

/**
 * Categories follow a company to its new manager (dev-docs/companies.md).
 *
 * A category belongs to one user, and a transaction, a split or a recurring
 * series points at one. After a hand-over the company's transactions would
 * still point at the previous manager's categories: outside the new
 * manager's budgets, still counted in the previous one's. So each category of
 * the previous manager that the company's accounts use is mapped onto the
 * new manager's category of the same name - created, with its colour and
 * kind but no budget, when they have none - and every row is re-pointed.
 *
 * A plain module, not a "use server" one: transferCompanyManagement calls it
 * inside its transaction, once it has checked the caller manages the company.
 */

type Tx = Pick<typeof prisma, "category" | "transaction" | "transactionSplit" | "recurringTransaction">;

export async function moveCompanyCategories(
  tx: Tx,
  accountIds: string[],
  fromUserId: string,
  toUserId: string,
): Promise<number> {
  if (accountIds.length === 0) return 0;
  const onAccounts = { accountId: { in: accountIds } };
  const used = await tx.category.findMany({
    where: {
      userId: fromUserId,
      OR: [
        { transactions: { some: onAccounts } },
        { transactionSplits: { some: { transaction: onAccounts } } },
        { recurringTransactions: { some: onAccounts } },
      ],
    },
    select: { id: true, name: true, color: true, kind: true },
  });
  for (const category of used) {
    const target = await tx.category.upsert({
      where: { userId_name: { userId: toUserId, name: category.name } },
      create: { userId: toUserId, name: category.name, color: category.color, kind: category.kind },
      update: {},
      select: { id: true },
    });
    const moved = { categoryId: target.id };
    await tx.transaction.updateMany({ where: { ...onAccounts, categoryId: category.id }, data: moved });
    await tx.transactionSplit.updateMany({ where: { transaction: onAccounts, categoryId: category.id }, data: moved });
    await tx.recurringTransaction.updateMany({ where: { ...onAccounts, categoryId: category.id }, data: moved });
  }
  return used.length;
}
