/**
 * SyncLog.source shapes, in one place.
 *
 * The companion to lib/domain/sync-ids.ts: that one names the shapes of
 * `Account.syncId` (which row a sync owns), this one names the shapes of
 * `SyncLog.source` (which connection reported a run). They are separate
 * vocabularies and neither can be derived from the other.
 *
 *   lcl                      env-configured LCL, owner only
 *   trade_republic           env-configured Trade Republic, owner only
 *   trade_republic_realtime  the env listener's own diagnostic channel
 *   woob:<institutionId>     per-user Woob
 *   tr:<institutionId>       per-user Trade Republic (v2.1)
 *   tr-realtime:<institutionId>  that connection's listener (v2.3)
 *   yahoo_sector_data        not a sync at all - the sector-data health probe
 *                            reusing SyncFailureState, see the alerts route
 *
 * `sync/db.py`'s `_sync_log_owner` is the Python mirror of `sourceInstitutionId`
 * below. The two must agree on which prefixes carry an institution id: that is
 * what decides whose SyncLog row a sync writes.
 */

export const SOURCE_LCL = "lcl";
export const SOURCE_TRADE_REPUBLIC = "trade_republic";
export const SOURCE_TRADE_REPUBLIC_REALTIME = "trade_republic_realtime";

export const WOOB_SOURCE_PREFIX = "woob:";
export const TR_SOURCE_PREFIX = "tr:";
export const TR_REALTIME_SOURCE_PREFIX = "tr-realtime:";

/** The listener source for one per-user Trade Republic connection. */
export function trRealtimeSource(institutionId: string): string {
  return `${TR_REALTIME_SOURCE_PREFIX}${institutionId}`;
}

/**
 * The institution a source belongs to, or null for the env-configured ones
 * (which belong to the instance owner and have no Institution row driving
 * them).
 *
 * The listener prefix is a sibling (`tr-realtime:<id>`), never a nested
 * `tr:<id>:realtime`: the Python mirror reads a third segment as "not an
 * institution id", so the nested shape files every listener row under the
 * instance owner instead of the connection's real owner.
 */
export function sourceInstitutionId(source: string): string | null {
  for (const prefix of [TR_REALTIME_SOURCE_PREFIX, WOOB_SOURCE_PREFIX, TR_SOURCE_PREFIX]) {
    if (!source.startsWith(prefix)) continue;
    const id = source.slice(prefix.length);
    // A remaining colon is not a plain institution id: refuse rather than guess.
    return id && !id.includes(":") ? id : null;
  }
  return null;
}

/**
 * A real-time listener rather than a sync. These must never raise a
 * sync-failure alert: the listener and its batch sync share one session, so a
 * dead one fails both, and only the batch sync's alert names something the
 * user recognises. The rows are still written and visible in Settings.
 */
export function isRealtimeSource(source: string): boolean {
  return source === SOURCE_TRADE_REPUBLIC_REALTIME || source.startsWith(TR_REALTIME_SOURCE_PREFIX);
}

/** True for a per-user Trade Republic connection's own batch-sync source. */
export function isPerUserTrSource(source: string): boolean {
  return source.startsWith(TR_SOURCE_PREFIX);
}
