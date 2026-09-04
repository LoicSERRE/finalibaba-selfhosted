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
 * `captcha_required` exists because the two questions below have different
 * answers for it, and no pre-existing status did. It is reconnectable, so the
 * Connect button must appear (`auth_required` gets that right). But the
 * scheduled sync can NEVER clear it on its own - a captcha token is single-use
 * and expires in about two minutes, so the 4h cron lands right back here
 * forever. Filing it as `auth_required` would therefore have the failure alert
 * remind the user every 24h, for good, about something they already know and
 * cannot automate away. Filing it as `unsupported` would be the opposite lie:
 * it would hide the very button that makes the bank work.
 *
 * Same "nothing will ever clear this on its own" dead end `isSourceRetired`
 * was written for, reached from a third direction: not a source that stopped
 * running, nor one that never could, but one that only ever runs by hand.
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
 * Can an unattended run ever clear this state, or does it always need a person?
 *
 * True only for `captcha_required`: a captcha token is single-use and expires in
 * about two minutes, and a bank that has MFA on refuses to start a login outside
 * an interactive session at all, so "Synchronize" on such a bank cannot succeed
 * - now or ever. Offering it next to "Connect" put two buttons side by side of
 * which one always failed, and its failure overwrote the successful connection
 * with a warning triangle seconds later. Reported from a real instance right
 * after a connection that had in fact worked.
 *
 * Deliberately NOT true for `auth_required`: an expired session often comes back
 * on the next scheduled run, so hiding the button there would remove something
 * that does work.
 */
export function reconnectOnlyRefreshes(status: string | null | undefined): boolean {
  return status === SYNC_STATUS_CAPTCHA_REQUIRED;
}

/**
 * The four visual states a sync status collapses to, and the i18n key that
 * explains each one.
 *
 * Extracted because `app/settings/page.tsx` carried the same four-way branch
 * three times over - once for the colour, once for the aria-label, once for the
 * icon - so adding `captcha_required` meant editing the same decision in three
 * places and hoping they stayed in step. One function, one decision.
 *
 * `unsupported` is deliberately muted rather than red: red invites retrying
 * something that can never work. `captcha_required` shares the warning tone
 * with `auth_required` because both are asking for the same thing - a person.
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
 * What the failure-alert pass should do about one sync source.
 *
 * Extracted from the loop in `app/api/alerts/check/route.ts`, which had grown
 * five sequential guards in front of the alerting itself - each individually
 * obvious, together over the complexity gate and, more to the point, no longer
 * readable as a single decision. Callers compute the two facts this cannot know
 * (a retired source, a realtime channel) and pass them in, so it stays pure.
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
  // A listener shares one bank session with its batch sync, so a dead session
  // fails both and only the batch sync's alert names something recognisable.
  if (input.isRealtime) return "clear";
  // Nothing will ever write a fresh success row for these two, so a kept state
  // row would remind forever with no way to self-heal.
  if (input.isRetired) return "clear";
  if (input.status === SYNC_STATUS_SUCCESS) return "clear";
  if (input.status === SYNC_STATUS_UNSUPPORTED) return "clear";
  // Worth one notification, never a reminder - the state row is what remembers
  // that the one notification already went out.
  if (alertsOnlyOnce(input.status) && input.hasState) return "silent";
  return "alert";
}
