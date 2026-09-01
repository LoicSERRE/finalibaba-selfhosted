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
 * Written because the per-user sources arrived in v2.1 and nothing that reads
 * this column was taught about them: the alerts route still special-cased
 * `woob:` alone, so a Trade Republic institution's failure notification was
 * titled with a raw cuid - the exact "never surface a raw internal identifier
 * to a human" bug that had already been found and fixed once for Woob. A
 * shared parser is the structural version of that fix.
 *
 * `sync/db.py`'s `_sync_log_owner` is the Python mirror of `sourceInstitutionId`
 * below; the two must agree on which prefixes carry an institution id, because
 * that is what decides whose SyncLog row a sync writes.
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
 * The listener uses a sibling prefix (`tr-realtime:<id>`) rather than a nested
 * `tr:<id>:realtime`, and that is not cosmetic: the Python mirror splits on
 * ":" and reads a third segment as "not an institution id", so the nested
 * shape would have silently attributed every listener row to the instance
 * owner instead of the connection's real owner. `tr-realtime:` does not start
 * with `tr:`, so the two never overlap whatever order they are tested in.
 */
export function sourceInstitutionId(source: string): string | null {
  for (const prefix of [TR_REALTIME_SOURCE_PREFIX, WOOB_SOURCE_PREFIX, TR_SOURCE_PREFIX]) {
    if (!source.startsWith(prefix)) continue;
    const id = source.slice(prefix.length);
    // A remaining colon means this is not a plain institution id, so refuse
    // rather than guess - the same conservative reading the Python side takes.
    return id && !id.includes(":") ? id : null;
  }
  return null;
}

/**
 * True for a source that reports on a real-time listener rather than a sync.
 *
 * These must never raise a sync-failure alert of their own. A listener and the
 * batch sync behind it share one Trade Republic session, so a dead session
 * makes both fail - and the batch sync is the one that alerts with a name the
 * user recognises and a reconnect prompt they can act on. Alerting twice for
 * one cause is noise, and the second copy was titled "trade_republic_realtime"
 * in the user's notifications, which names nothing.
 *
 * The rows are still written and still visible in Settings: this suppresses
 * the notification, not the diagnosis.
 */
export function isRealtimeSource(source: string): boolean {
  return source === SOURCE_TRADE_REPUBLIC_REALTIME || source.startsWith(TR_REALTIME_SOURCE_PREFIX);
}

/** True for a per-user Trade Republic connection's own batch-sync source. */
export function isPerUserTrSource(source: string): boolean {
  return source.startsWith(TR_SOURCE_PREFIX);
}
