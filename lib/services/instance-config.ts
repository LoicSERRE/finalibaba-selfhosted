import { prisma } from "@/lib/db/prisma";
import { initialBaseCurrency, parseBaseCurrency, type BaseCurrency } from "@/lib/utils/base-currency";

const SINGLETON = "singleton";

/**
 * Settles the instance's base currency and makes it the process's
 * BASE_CURRENCY, which baseCurrency() and the root layout read (v2.19). Run
 * once per server start from instrumentation.ts, after migrations.
 *
 * The first boot under v2.19 stores it - BASE_CURRENCY on a fresh install,
 * EUR on one that already has accounts (initialBaseCurrency). From then on
 * the stored value wins: a variable changed later is reported, never
 * obeyed, because obeying it would print every existing EUR figure as
 * dollars. Converting an instance is a deliberate operation, not an edit
 * to .env.
 */
export async function settleBaseCurrency(): Promise<{ base: BaseCurrency; requested: BaseCurrency }> {
  const requested = parseBaseCurrency(process.env.BASE_CURRENCY);
  let row = await prisma.instanceConfig.findUnique({ where: { id: SINGLETON } });
  if (!row) {
    const hasData = (await prisma.account.count()) > 0;
    // upsert, not create: two instances booting against one database must
    // not both insert - the second simply reads the first one's choice.
    row = await prisma.instanceConfig.upsert({
      where: { id: SINGLETON },
      create: { id: SINGLETON, baseCurrency: initialBaseCurrency(process.env.BASE_CURRENCY, hasData) },
      update: {},
    });
  }
  const base = parseBaseCurrency(row.baseCurrency);
  process.env.BASE_CURRENCY = base;
  return { base, requested };
}
