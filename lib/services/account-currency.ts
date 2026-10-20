import { prisma } from "@/lib/db/prisma";
import { dayKey, isBaseCurrency, isCurrencyCode, redenominate } from "@/lib/domain/currency";
import { ratesToBaseForDays } from "@/lib/services/exchange-rate";

/**
 * The currency to store a synced account's figures in, or null to skip
 * them this time - the app-side twin of sync/db.py's
 * resolve_account_currency, for GoCardless (v2.18, dev-docs/currencies.md).
 *
 * `reported` is what the bank said; anything that is not an ISO code means
 * "unknown" and keeps the account's own. An account still EUR while its
 * bank reports another currency was created before v2.18: its history is
 * re-denominated at each row's own day's rate, all at once or not at all.
 * Any other change is not something a bank does to an account, and is
 * skipped rather than rewritten.
 */
export async function resolveSyncedAccountCurrency(accountId: string, reported: string | null | undefined): Promise<string | null> {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { currency: true } });
  if (!isCurrencyCode(reported) || reported === account.currency) return account.currency;
  if (!isBaseCurrency(account.currency)) return null;

  const [balances, transactions] = await Promise.all([
    prisma.historicalBalance.findMany({
      where: { accountId, nativeBalanceCents: null },
      select: { id: true, balanceCents: true, recordedAt: true },
    }),
    prisma.transaction.findMany({
      where: { accountId, nativeAmountCents: null },
      select: { id: true, amountCents: true, date: true },
    }),
  ]);
  const balanceRows = balances.map((b) => ({ id: b.id, cents: b.balanceCents, day: dayKey(b.recordedAt) }));
  const transactionRows = transactions.map((t) => ({ id: t.id, cents: t.amountCents, day: dayKey(t.date) }));
  const rates = await ratesToBaseForDays(reported, [...balanceRows, ...transactionRows].map((r) => r.day));
  const newBalances = redenominate(balanceRows, rates);
  const newTransactions = redenominate(transactionRows, rates);
  if (!newBalances || !newTransactions) return null;

  await prisma.$transaction([
    ...newBalances.map((r) =>
      prisma.historicalBalance.update({ where: { id: r.id }, data: { nativeBalanceCents: r.native, balanceCents: r.base, fxRate: r.rate } })
    ),
    ...newTransactions.map((r) =>
      prisma.transaction.update({ where: { id: r.id }, data: { nativeAmountCents: r.native, amountCents: r.base, fxRate: r.rate } })
    ),
    prisma.account.update({ where: { id: accountId }, data: { currency: reported } }),
  ]);
  return reported;
}
