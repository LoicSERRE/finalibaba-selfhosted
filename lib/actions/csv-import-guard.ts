import { prisma } from "@/lib/db/prisma";

const FIAT_TYPES = new Set(["CHECKING", "SAVINGS", "MEAL_VOUCHER"]);

// Mirrors the `canImportCsv` UI gate in app/accounts/[id]/page.tsx. That gate
// only controls whether the import buttons render - Server Actions are
// reachable directly regardless of what's on screen, so the same rule must
// be enforced here too before writing anything.
export async function assertCsvImportEligible(accountId: string): Promise<void> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { type: true, syncId: true, gocardlessAccountId: true },
  });
  if (!account) throw new Error("Account not found.");
  if (!FIAT_TYPES.has(account.type) || account.syncId || account.gocardlessAccountId) {
    throw new Error("This account is not eligible for CSV import.");
  }
}
