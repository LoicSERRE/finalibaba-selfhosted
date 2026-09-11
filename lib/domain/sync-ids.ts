/**
 * Account.syncId shapes, in one place.
 *
 * Every sync stamps the accounts it creates so the next run recognises its own
 * rows. The column is globally unique, so a source that can run once per user
 * needs the user in the id:
 *
 *   lcl:<nativeId>                  env-configured LCL, owner only
 *   tr:<suffix>                     env-configured Trade Republic, owner only
 *   tr:<institutionId>:<suffix>     per-user Trade Republic (v2.1)
 *   woob:<institutionId>:<nativeId> per-user Woob, namespaced from the start
 *   gocardless_<transactionId>      GoCardless (transactions, not accounts)
 *   csv_<uuid>                      CSV import (transactions)
 *
 * The two Trade Republic shapes coexist: the env sync keeps writing the legacy
 * two-segment id so existing installs are untouched. Segment count tells them
 * apart, because no suffix below contains a colon.
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
 * Trade Republic's cash account, under either shape. Never compare against the
 * literal "tr:cash": it stops matching for a per-user account with no error,
 * just a quietly understated passive-income figure.
 */
export function isTrCashAccount(syncId: string | null | undefined): boolean {
  return parseTrSuffix(syncId) === "cash";
}

/**
 * An account from an env-configured, owner-only sync. This is the set
 * `migrateDedicatedSyncToWoob` DELETES, so it must never include a per-user
 * Trade Republic account.
 */
export function isLegacyEnvSyncId(syncId: string | null | undefined): boolean {
  if (!syncId) return false;
  if (syncId.startsWith("lcl:")) return true;
  if (!syncId.startsWith(TR_PREFIX)) return false;
  return !syncId.slice(TR_PREFIX.length).includes(":");
}

/**
 * An exact list, never the `tr:` prefix - which also matches
 * `tr:<institutionId>:`, so deleting by prefix during a migration takes the
 * accounts that migration just created.
 */
export function legacyTrSyncIds(): string[] {
  return TR_ACCOUNT_SUFFIXES.map((suffix) => `${TR_PREFIX}${suffix}`);
}

/** True for an account created by the per-user path for this institution. */
export function isPerUserSyncId(syncId: string | null | undefined, institutionId: string): boolean {
  if (!syncId) return false;
  return (
    syncId.startsWith(`${TR_PREFIX}${institutionId}:`) || syncId.startsWith(`woob:${institutionId}:`)
  );
}
