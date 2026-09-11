import { afterEach, describe, expect, it } from "vitest";
import {
  friendlySourceLabel,
  isSourceRetired,
  formatSyncFailureBody,
  type InstitutionLite,
} from "@/lib/services/alerts/sync-failures";
import { buildNewTransactionAmountFilter } from "@/lib/services/alerts/custom-rules";
import { SYNC_STATUS_CAPTCHA_REQUIRED } from "@/lib/domain/sync-status";

/**
 * The pure half of the alert machinery, at 0% until v2.10.4 moved it out of
 * app/api/ - which sonar.coverage.exclusions drops wholesale, so it reported
 * nothing rather than nothing covered.
 *
 * Two of these have caused real production incidents and were each fixed
 * TWICE, which is exactly the recurring-pattern signal the release audit says
 * to look for: `friendlySourceLabel` announced a failure by its raw cuid, and
 * `isSourceRetired` kept reminding a user every 24h that a bank they had
 * removed was "still broken", with nothing able to clear it. Both were written
 * for `woob:` and both then missed the second per-institution prefix `tr:` when
 * v2.1 added it. A third prefix would miss them again, so what these pin is
 * every prefix, not the happy one.
 */

const WOOB: InstitutionLite = { id: "inst-1", name: "Boursorama", woobModule: "boursorama", trPhone: null };
const TR: InstitutionLite = { id: "inst-2", name: "Trade Republic perso", woobModule: null, trPhone: "+33600000000" };
const MAP = new Map<string, InstitutionLite>([[WOOB.id, WOOB], [TR.id, TR]]);

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

describe("naming a broken source in a notification", () => {
  it("uses the fixed label for the two env-configured sources", () => {
    expect(friendlySourceLabel("lcl", MAP)).toBe("LCL");
    expect(friendlySourceLabel("trade_republic", MAP)).toBe("Trade Republic");
  });

  it("resolves a per-institution source to the institution's own name", () => {
    expect(friendlySourceLabel("woob:inst-1", MAP)).toBe("Boursorama");
    expect(friendlySourceLabel("tr:inst-2", MAP)).toBe("Trade Republic perso");
    expect(friendlySourceLabel("tr-realtime:inst-2", MAP)).toBe("Trade Republic perso");
  });

  it("never puts a raw cuid in front of a user when the lookup misses", () => {
    // The incident this exists for. A deleted institution still has a
    // SyncFailureState row naming it, and "woob:cm3x8f..." tells nobody
    // anything.
    expect(friendlySourceLabel("woob:gone", MAP)).toBe("une banque configurée via Woob");
    expect(friendlySourceLabel("tr:gone", MAP)).toBe("Trade Republic");
    expect(friendlySourceLabel("woob:gone", MAP)).not.toContain("gone");
  });

  it("falls back to the source itself for something it does not recognise", () => {
    expect(friendlySourceLabel("yahoo_sector_data", MAP)).toContain("Yahoo");
    expect(friendlySourceLabel("something_new", MAP)).toBe("something_new");
  });
});

describe("a source that will never report again is retired, not broken", () => {
  it("retires the env sources exactly when their credential is gone", () => {
    delete process.env.LCL_LOGIN;
    delete process.env.TR_PHONE;
    expect(isSourceRetired("lcl", MAP)).toBe(true);
    expect(isSourceRetired("trade_republic", MAP)).toBe(true);

    process.env.LCL_LOGIN = "user";
    process.env.TR_PHONE = "+33600000000";
    expect(isSourceRetired("lcl", MAP)).toBe(false);
    expect(isSourceRetired("trade_republic", MAP)).toBe(false);
  });

  it("retires a source whose institution no longer exists", () => {
    expect(isSourceRetired("woob:gone", MAP)).toBe(true);
    expect(isSourceRetired("tr:gone", MAP)).toBe(true);
  });

  it("asks the right credential per backend, not just woobModule", () => {
    // The second miss: written for woob: only, so a Trade Republic connection
    // that had been removed kept reminding forever - it has no woobModule by
    // construction, which the woob-shaped check read as "config cleared".
    expect(isSourceRetired("woob:inst-1", MAP)).toBe(false);
    expect(isSourceRetired("tr:inst-2", MAP)).toBe(false);
    expect(isSourceRetired("tr-realtime:inst-2", MAP)).toBe(false);

    const clearedTr = new Map(MAP).set("inst-2", { ...TR, trPhone: null });
    expect(isSourceRetired("tr:inst-2", clearedTr)).toBe(true);
    const clearedWoob = new Map(MAP).set("inst-1", { ...WOOB, woobModule: null });
    expect(isSourceRetired("woob:inst-1", clearedWoob)).toBe(true);
  });

  it("never retires a source it does not recognise", () => {
    // Silence is the wrong default here: a source nothing knows about must
    // keep alerting rather than be quietly written off.
    expect(isSourceRetired("yahoo_sector_data", MAP)).toBe(false);
  });
});

describe("what the notification actually says", () => {
  it("tells a captcha bank the automatic sync cannot do it for them", () => {
    const body = formatSyncFailureBody("Amundi", SYNC_STATUS_CAPTCHA_REQUIRED);
    expect(body).toContain("Amundi");
    expect(body).toContain("captcha");
    expect(body).toContain("automatique");
  });

  it("tells an expired connection to reconnect, and says nothing about captchas", () => {
    const body = formatSyncFailureBody("LCL", "auth_required");
    expect(body).toContain("Reconnecte-toi");
    expect(body).not.toContain("captcha");
  });

  it("never surfaces the raw status string or a stack trace", () => {
    // A user reported the raw Python exception text as unreadable in a push
    // notification; the body is two fixed sentences keyed on status instead.
    const body = formatSyncFailureBody("Boursorama", "error");
    expect(body).toContain("Boursorama");
    expect(body).not.toContain("error");
    expect(body).not.toContain("Traceback");
  });
});

describe("which transactions a NEW_TRANSACTION rule watches", () => {
  it("matches only debits, or only credits, when a direction is set", () => {
    expect(buildNewTransactionAmountFilter("DEBIT", null)).toEqual({ amountCents: { lt: BigInt(0) } });
    expect(buildNewTransactionAmountFilter("CREDIT", null)).toEqual({ amountCents: { gt: BigInt(0) } });
  });

  it("reads the minimum as a MAGNITUDE, so a debit floor is negative", () => {
    expect(buildNewTransactionAmountFilter("DEBIT", BigInt(50_00))).toEqual({ amountCents: { lte: BigInt(-50_00) } });
    expect(buildNewTransactionAmountFilter("CREDIT", BigInt(50_00))).toEqual({ amountCents: { gte: BigInt(50_00) } });
  });

  it("matches everything when neither a direction nor a floor is set", () => {
    expect(buildNewTransactionAmountFilter(null, null)).toEqual({});
  });

  it("excludes the band around zero when only a floor is set", () => {
    // Both directions with a floor needs two disjoint half-lines, never one
    // range: "at least 50 EUR" means a big debit OR a big credit, and the
    // gap between them has to be excluded. The sibling bug in
    // transactions-ledger.ts - two ranges OR'd together being a tautology
    // that silently matched everything - is the reason this is asserted on
    // shape rather than on "it filters".
    const filter = buildNewTransactionAmountFilter(null, BigInt(50_00));
    expect(filter.OR).toHaveLength(2);
    const json = JSON.stringify(filter, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(json).toContain("-5000");
    expect(json).toContain("5000");
  });
});
