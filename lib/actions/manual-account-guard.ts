import { prisma } from "@/lib/db/prisma";
import { getViewer, assertAccountWritable } from "@/lib/auth-context";

const FIAT_TYPES = new Set(["CHECKING", "SAVINGS", "MEAL_VOUCHER"]);

// "Is this a fiat account whose data nobody but the user writes?" - the single
// question behind both CSV import and manual entry, asked in one place rather
// than twice. A synced or GoCardless-linked account is excluded because its
// rows have an external source of truth: importing onto it duplicates what the
// next sync brings back, and a manual entry shifting its recorded balances
// would overwrite the bank's own history.
//
// Mirrors the `canImportCsv` UI gate in app/accounts/[id]/page.tsx. That gate
// only controls whether the buttons render - Server Actions are reachable
// directly regardless of what's on screen, so the same rule must be enforced
// here too before writing anything.
export async function assertManualAccountEligible(accountId: string): Promise<void> {
  // Ownership first: this guard already argued that a Server Action is
  // reachable regardless of the UI, and that reasoning applies just as much
  // to *whose* account it is as to whether the type is eligible.
  const viewer = await getViewer();
  await assertAccountWritable(viewer.id, accountId);

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { type: true, syncId: true, gocardlessAccountId: true },
  });
  if (!account) throw new Error("Account not found.");
  if (!FIAT_TYPES.has(account.type) || account.syncId || account.gocardlessAccountId) {
    throw new Error("This account is not eligible for manual edits.");
  }
}
