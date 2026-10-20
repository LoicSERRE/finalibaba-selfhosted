import { Decimal } from "decimal.js";
import { prisma } from "@/lib/db/prisma";
import { BASE_CURRENCY, dayKey, revaluation } from "@/lib/domain/currency";
import { rateToEurOn } from "@/lib/services/exchange-rate";

/**
 * Records an investment or crypto account's current value as a
 * `HistoricalBalance` row, derived from that account's own holdings.
 *
 * **A plain module rather than a Server Action, and that is the point.** It
 * used to be exported from `lib/actions/holdings.ts`, which carries
 * `"use server"` - so every export there is directly invocable from a browser
 * with attacker-chosen arguments. The post-v2.0 security audit flagged it
 * (finding 6) and left it open on the reasoning that it is a pure recompute:
 * it derives a balance from the account's own rows and writes nothing the
 * caller supplies, so calling it against someone else's account can neither
 * disclose nor corrupt anything.
 *
 * That reasoning was correct and is still not a reason to leave it reachable.
 * It cannot be ownership-guarded, because the 4h cron
 * (`app/api/investments/snapshot-balances`) calls it server-to-server with no
 * session to resolve a viewer from - so the fix is to take it off the remote
 * surface entirely instead. Every caller already imports it server-side, so
 * moving it changes no behaviour at all.
 *
 * Same move, for the same reason, that `autoCategorizeTransactions` made to
 * `lib/services/auto-categorize-runner.ts` when it needed a userId parameter.
 */
export async function refreshAccountBalance(accountId: string) {
  const holdings = await prisma.holding.findMany({ where: { accountId } });
  const totalCents = holdings.reduce((sum, h) => {
    const value = new Decimal(h.quantity.toString())
      .mul(new Decimal(h.lastPriceCents.toString()))
      .round()
      .toNumber();
    return sum + BigInt(value);
  }, BigInt(0));

  await prisma.historicalBalance.create({
    data: { accountId, balanceCents: totalCents },
  });
}

/**
 * Records today's EUR value of every account kept in another currency that
 * nothing else revalues (v2.18, dev-docs/currencies.md): its native balance
 * does not move, the rate does. Manual accounts, and GoCardless ones, which
 * only sync when someone presses the button; Woob accounts are revalued by
 * their own 4h sync (sync/db.py's record_balance). Run by the same cron as
 * the investment snapshots; at most one row per account per day, since rates
 * are daily.
 */
export async function revalueForeignBalances(now: Date = new Date()): Promise<number> {
  const accounts = await prisma.account.findMany({
    where: { currency: { not: BASE_CURRENCY }, syncId: null },
    select: {
      id: true,
      currency: true,
      history: {
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { recordedAt: true, balanceCents: true, nativeBalanceCents: true },
      },
    },
  });
  const todayNoon = new Date(`${dayKey(now)}T12:00:00.000Z`);
  let written = 0;
  for (const account of accounts) {
    const latest = account.history[0];
    if (!latest) continue;
    const rate = await rateToEurOn(account.currency, now);
    // No rate today: keep yesterday's value rather than invent one.
    if (rate === null) continue;
    const row = revaluation(latest, account.currency, rate, todayNoon);
    if (!row) continue;
    await prisma.historicalBalance.create({ data: { accountId: account.id, ...row } });
    written++;
  }
  return written;
}
