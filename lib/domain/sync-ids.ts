/**
 * Account.syncId shapes, in one place.
 *
 * Every sync source stamps the accounts it creates with a `syncId` so the next
 * run recognises its own rows instead of duplicating them. That column is
 * globally unique, which is fine while a source can only ever run once per
 * instance, and a real collision as soon as it can run once per user:
 *
 *   lcl:<nativeId>                  env-configured LCL, owner only
 *   tr:<suffix>                     env-configured Trade Republic, owner only
 *   tr:<institutionId>:<suffix>     per-user Trade Republic (v2.1)
 *   woob:<institutionId>:<nativeId> per-user Woob, namespaced from the start
 *   gocardless_<transactionId>      GoCardless (transactions, not accounts)
 *   csv_<uuid>                      CSV import (transactions)
 *
 * The two Trade Republic shapes coexist deliberately, the same way `lcl:` and
 * `woob:<id>:` already do: the env-driven sync keeps writing the legacy
 * two-segment id so existing installs are untouched, and the per-user path
 * writes the three-segment one. They are unambiguous because the suffix set
 * below never contains a colon, so segment count alone tells them apart.
 */

/** The account kinds Trade Republic can produce - mirrors sync_tr.py's ACC_TYPE_MAP. */
export const TR_ACCOUNT_SUFFIXES = ["cash", "cto", "pea", "crypto"] as const;
export type TrAccountSuffix = (typeof TR_ACCOUNT_SUFFIXES)[number];

export const TR_PREFIX = "tr:";

/** `tr:cash` (owner, env-configured) or `tr:<institutionId>:cash` (per user). */
export function buildTrSyncId(suffix: TrAccountSuffix, institutionId?: string | null): string {
  return institutionId ? `${TR_PREFIX}${institutionId}:${suffix}` : `${TR_PREFIX}${suffix}`;
}

/**
 * The suffix of a Trade Republic account id, or null if this is not one.
 * Accepts both shapes so callers never have to know which sync produced a row.
 */
export function parseTrSuffix(syncId: string | null | undefined): TrAccountSuffix | null {
  if (!syncId?.startsWith(TR_PREFIX)) return null;
  const parts = syncId.slice(TR_PREFIX.length).split(":");
  // 1 part = legacy `tr:cash`; 2 parts = `tr:<institutionId>:cash`. Anything
  // else is not a shape this app writes.
  if (parts.length > 2) return null;
  const suffix = parts.at(-1);
  return (TR_ACCOUNT_SUFFIXES as readonly string[]).includes(suffix ?? "")
    ? (suffix as TrAccountSuffix)
    : null;
}

/**
 * Whether this is Trade Republic's cash account, under either shape.
 *
 * lib/domain/analytics.ts used to compare against the literal `"tr:cash"` to
 * apply TR's own cash interest rate to the passive-income estimate. That
 * comparison silently stops matching the moment an account is synced through
 * the per-user path, and the failure is invisible: no error, just a slightly
 * understated figure.
 */
export function isTrCashAccount(syncId: string | null | undefined): boolean {
  return parseTrSuffix(syncId) === "cash";
}

/**
 * True for an account created by one of the env-configured, owner-only syncs
 * (LCL or the legacy two-segment Trade Republic path).
 *
 * This is the set `migrateDedicatedSyncToWoob` deletes and the Settings page
 * counts, and it must NOT include per-user Trade Republic accounts: those are
 * not legacy, and nothing should offer to migrate them away.
 */
export function isLegacyEnvSyncId(syncId: string | null | undefined): boolean {
  if (!syncId) return false;
  if (syncId.startsWith("lcl:")) return true;
  if (!syncId.startsWith(TR_PREFIX)) return false;
  return !syncId.slice(TR_PREFIX.length).includes(":");
}
