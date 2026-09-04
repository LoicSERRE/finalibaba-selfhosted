import { describe, it, expect } from "vitest";
import {
  needsReconnection,
  alertsOnlyOnce,
  reconnectOnlyRefreshes,
  classifySyncSource,
  syncStatusTone,
  syncStatusLabelKey,
  SYNC_STATUS_SUCCESS,
  SYNC_STATUS_ERROR,
  SYNC_STATUS_AUTH_REQUIRED,
  SYNC_STATUS_CAPTCHA_REQUIRED,
  SYNC_STATUS_UNSUPPORTED,
} from "@/lib/domain/sync-status";

/**
 * `captcha_required` exists because the two questions below have different
 * answers for it, and no pre-existing status did. These tests pin exactly that
 * split - if a future change collapses the status back into `auth_required` or
 * `unsupported`, one of the two halves breaks.
 */
describe("needsReconnection - does the UI offer a Connect button?", () => {
  it("offers it for a captcha, because a human can solve one", () => {
    // Classifying a captcha as "unsupported" hid this button on a bank that
    // works (issue #51's first fix).
    expect(needsReconnection(SYNC_STATUS_CAPTCHA_REQUIRED)).toBe(true);
  });

  it("still offers it for an expired session", () => {
    expect(needsReconnection(SYNC_STATUS_AUTH_REQUIRED)).toBe(true);
  });

  it("does not offer it when nothing a human clicks would help", () => {
    expect(needsReconnection(SYNC_STATUS_UNSUPPORTED)).toBe(false);
    expect(needsReconnection(SYNC_STATUS_SUCCESS)).toBe(false);
    expect(needsReconnection(SYNC_STATUS_ERROR)).toBe(false);
  });

  it("treats a missing status as nothing to reconnect", () => {
    // A never-synced institution has no SyncLog row at all.
    expect(needsReconnection(null)).toBe(false);
    expect(needsReconnection(undefined)).toBe(false);
  });
});

describe("alertsOnlyOnce - should the 24h reminder be suppressed?", () => {
  it("suppresses it for a captcha, which no scheduled run can ever clear", () => {
    // The token is single-use and expires in ~2 minutes, so the 4h cron lands
    // right back on this status forever. Reminding daily is noise about a
    // situation the user already knows and cannot automate away.
    expect(alertsOnlyOnce(SYNC_STATUS_CAPTCHA_REQUIRED)).toBe(true);
  });

  it("keeps reminding for failures that a retry might genuinely fix", () => {
    // The guard against over-reaching: silencing these would hide real,
    // recoverable breakage.
    expect(alertsOnlyOnce(SYNC_STATUS_AUTH_REQUIRED)).toBe(false);
    expect(alertsOnlyOnce(SYNC_STATUS_ERROR)).toBe(false);
  });

  it("says nothing about statuses the reminder path never reaches", () => {
    // `unsupported` is handled earlier by its own branch (state cleared,
    // never alerted); success exits before this is consulted.
    expect(alertsOnlyOnce(SYNC_STATUS_UNSUPPORTED)).toBe(false);
    expect(alertsOnlyOnce(SYNC_STATUS_SUCCESS)).toBe(false);
    expect(alertsOnlyOnce(null)).toBe(false);
  });
});

describe("the two questions are genuinely independent", () => {
  it("is the only status that answers yes to both", () => {
    // The whole reason the status had to be added: auth_required is
    // reconnectable but self-clearing, unsupported is neither.
    const all = [
      SYNC_STATUS_SUCCESS,
      SYNC_STATUS_ERROR,
      SYNC_STATUS_AUTH_REQUIRED,
      SYNC_STATUS_CAPTCHA_REQUIRED,
      SYNC_STATUS_UNSUPPORTED,
    ];
    const both = all.filter((s) => needsReconnection(s) && alertsOnlyOnce(s));
    expect(both).toEqual([SYNC_STATUS_CAPTCHA_REQUIRED]);
  });
});

describe("classifySyncSource - every reason to skip a source, in one decision", () => {
  const base = { status: SYNC_STATUS_ERROR, isRetired: false, isRealtime: false, hasState: false };

  it("alerts on a plain failure", () => {
    expect(classifySyncSource(base)).toBe("alert");
  });

  it("clears on success", () => {
    expect(classifySyncSource({ ...base, status: SYNC_STATUS_SUCCESS })).toBe("clear");
  });

  it("clears a realtime source, whose failure the batch sync already reports", () => {
    // A listener and its batch sync share one Trade Republic session, so a dead
    // session fails both - and only the batch sync's alert names something the
    // user recognises.
    expect(classifySyncSource({ ...base, isRealtime: true })).toBe("clear");
  });

  it("clears a retired source, which nothing will ever write a success for", () => {
    expect(classifySyncSource({ ...base, isRetired: true })).toBe("clear");
  });

  it("clears an unsupported bank rather than alerting about it", () => {
    expect(classifySyncSource({ ...base, status: SYNC_STATUS_UNSUPPORTED })).toBe("clear");
  });

  it("alerts ONCE about a captcha, then goes silent", () => {
    // The whole point of keeping the state row: it is what remembers that the
    // one notification already went out.
    const captcha = { ...base, status: SYNC_STATUS_CAPTCHA_REQUIRED };
    expect(classifySyncSource({ ...captcha, hasState: false })).toBe("alert");
    expect(classifySyncSource({ ...captcha, hasState: true })).toBe("silent");
  });

  it("keeps reminding about an expired session, which a reconnect really does fix", () => {
    // The guard against over-reaching: this is the case the reminder exists for.
    const auth = { ...base, status: SYNC_STATUS_AUTH_REQUIRED };
    expect(classifySyncSource({ ...auth, hasState: true })).toBe("alert");
  });

  it("puts a retired realtime source in the clear bucket, not the alert one", () => {
    // Order matters: the skip reasons are checked before the status is.
    expect(classifySyncSource({ ...base, isRealtime: true, isRetired: true, hasState: true })).toBe("clear");
  });
});

describe("syncStatusTone / syncStatusLabelKey - one decision, not three ternaries", () => {
  it("maps each status to its tone", () => {
    expect(syncStatusTone(SYNC_STATUS_SUCCESS)).toBe("success");
    expect(syncStatusTone(SYNC_STATUS_AUTH_REQUIRED)).toBe("warning");
    expect(syncStatusTone(SYNC_STATUS_CAPTCHA_REQUIRED)).toBe("warning");
    // Muted, not red: red invites retrying something that can never work.
    expect(syncStatusTone(SYNC_STATUS_UNSUPPORTED)).toBe("muted");
    expect(syncStatusTone(SYNC_STATUS_ERROR)).toBe("negative");
  });

  it("gives a captcha its own label instead of borrowing the 2FA one", () => {
    expect(syncStatusLabelKey(SYNC_STATUS_CAPTCHA_REQUIRED)).toBe("captchaRequired");
    expect(syncStatusLabelKey(SYNC_STATUS_AUTH_REQUIRED)).toBe("authRequired");
  });

  it("falls back to error for a status it has never heard of", () => {
    // A future Python-side status must degrade to "something is wrong", never
    // to "everything is fine".
    expect(syncStatusTone("something_new")).toBe("negative");
    expect(syncStatusLabelKey("something_new")).toBe("error");
  });
});

describe("reconnectOnlyRefreshes", () => {
  // A captcha token is single-use and expires in about two minutes, and a bank
  // with MFA on refuses to start a login outside an interactive session, so
  // "Synchronize" can never succeed there. It used to sit next to "Connect",
  // fail, and overwrite the connection that had just worked with a warning
  // triangle - reported from a real instance seconds after a success.
  it("is true only for a captcha bank, the one a scheduled run can never clear", () => {
    expect(reconnectOnlyRefreshes(SYNC_STATUS_CAPTCHA_REQUIRED)).toBe(true);
  });

  // Deliberately false here: an expired session often comes back on its own, so
  // hiding the button would remove something that does work.
  it("is false for auth_required, where a later sync can still succeed", () => {
    expect(reconnectOnlyRefreshes(SYNC_STATUS_AUTH_REQUIRED)).toBe(false);
  });

  it("is false for every other status", () => {
    for (const status of [SYNC_STATUS_SUCCESS, SYNC_STATUS_ERROR, SYNC_STATUS_UNSUPPORTED, null, undefined]) {
      expect(reconnectOnlyRefreshes(status)).toBe(false);
    }
  });
});
