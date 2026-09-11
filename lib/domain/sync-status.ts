/**
 * SyncLog.status values, and the two questions the app actually asks of them.
 *
 * The companion to lib/domain/sync-sources.ts: that one names the shapes of
 * `SyncLog.source` (which connection reported a run), this one names the
 * values of `SyncLog.status` (how the run ended).
 *
 *   success           nothing to do
 *   error             something broke; retrying may fix it
 *   auth_required     the session expired or 2FA is due - reconnect and it works
 *   captcha_required  the bank wants a captcha (v2.5, see CLAUDE.md's
 *                     "Captcha banks") - reconnect and it works, but ONLY
 *                     when a human is present
 *   unsupported       this integration cannot drive the bank at all
 *
 * `captcha_required` exists because it is the only status that answers the two
 * questions below differently: reconnectable (so the Connect button must show,
 * like `auth_required`) but never clearable by a scheduled run (a captcha token
 * is single-use and expires in ~2 minutes, so the cron lands right back here).
 * Filed as `auth_required` it would remind every 24h forever; filed as
 * `unsupported` it would hide the button that makes the bank work.
 */

export const SYNC_STATUS_SUCCESS = "success";
export const SYNC_STATUS_ERROR = "error";
export const SYNC_STATUS_AUTH_REQUIRED = "auth_required";
export const SYNC_STATUS_CAPTCHA_REQUIRED = "captcha_required";
export const SYNC_STATUS_UNSUPPORTED = "unsupported";

/**
 * Should the UI offer a Connect button? True for the two statuses a human can
 * actually resolve from Settings.
 */
export function needsReconnection(status: string | null | undefined): boolean {
  return status === SYNC_STATUS_AUTH_REQUIRED || status === SYNC_STATUS_CAPTCHA_REQUIRED;
}

/**
 * Should the failure alert stop at one notification instead of reminding every
 * 24h? True when no scheduled run can ever clear the state by itself, so a
 * reminder carries no new information.
 */
export function alertsOnlyOnce(status: string | null | undefined): boolean {
  return status === SYNC_STATUS_CAPTCHA_REQUIRED;
}

/**
 * Hide "Synchronize"? True only for `captcha_required`, where it can never
 * succeed and its failure overwrites the connection that just worked with a
 * warning triangle. NOT for `auth_required`: an expired session often does come
 * back on the next run.
 */
export function reconnectOnlyRefreshes(status: string | null | undefined): boolean {
  return status === SYNC_STATUS_CAPTCHA_REQUIRED;
}

/**
 * The four visual states a status collapses to. `unsupported` is muted rather
 * than red - red invites retrying something that can never work.
 */
export type SyncStatusTone = "success" | "warning" | "muted" | "negative";

export function syncStatusTone(status: string): SyncStatusTone {
  if (status === SYNC_STATUS_SUCCESS) return "success";
  if (needsReconnection(status)) return "warning";
  if (status === SYNC_STATUS_UNSUPPORTED) return "muted";
  return "negative";
}

/** Key under the `syncStatus` namespace describing the state to a human. */
export function syncStatusLabelKey(status: string): string {
  if (status === SYNC_STATUS_SUCCESS) return "success";
  if (status === SYNC_STATUS_CAPTCHA_REQUIRED) return "captchaRequired";
  if (status === SYNC_STATUS_AUTH_REQUIRED) return "authRequired";
  if (status === SYNC_STATUS_UNSUPPORTED) return "unsupported";
  return "error";
}

/**
 * What the failure-alert pass should do about one source. Callers pass in the
 * two facts this cannot know (retired, realtime) so it stays pure.
 *
 *   clear   drop any state row: nothing is wrong, or nothing ever will be
 *   silent  something IS wrong and the user has already been told once
 *   alert   fall through to the create-or-remind logic
 */
export type SyncSourceVerdict = "clear" | "silent" | "alert";

export function classifySyncSource(input: {
  status: string;
  isRetired: boolean;
  isRealtime: boolean;
  hasState: boolean;
}): SyncSourceVerdict {
  // A listener shares its session with the batch sync, which alerts with a name
  // the user recognises.
  if (input.isRealtime) return "clear";
  // Nothing will ever write a fresh success row, so a kept row reminds forever.
  if (input.isRetired) return "clear";
  if (input.status === SYNC_STATUS_SUCCESS) return "clear";
  if (input.status === SYNC_STATUS_UNSUPPORTED) return "clear";
  // Worth one notification, never a reminder; the state row remembers it went.
  if (alertsOnlyOnce(input.status) && input.hasState) return "silent";
  return "alert";
}
