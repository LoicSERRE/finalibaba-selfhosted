import { woobNativeId } from "@/lib/domain/sync-ids";

/**
 * The types a user can give an account a Woob bank syncs (v2.22) - what a bank
 * account can actually be. Real estate and cars hold a value typed by hand, so
 * they are never a bank's to report.
 */
export const SYNCED_ACCOUNT_TYPES = ["CHECKING", "SAVINGS", "MEAL_VOUCHER", "INVESTMENT", "CRYPTO", "LOAN"] as const;
export type SyncedAccountType = (typeof SYNCED_ACCOUNT_TYPES)[number];

export function isSyncedAccountType(value: unknown): value is SyncedAccountType {
  return (SYNCED_ACCOUNT_TYPES as readonly unknown[]).includes(value);
}

/**
 * Only Woob accounts: theirs is the one sync that reads what the user picked
 * (sync_woob.py / sync_lcl.py). Trade Republic writes fixed kinds, and a
 * GoCardless loan would need its own sign handling.
 */
export function canPickSyncedType(syncId: string | null | undefined): boolean {
  return woobNativeId(syncId) !== null;
}
