import { describe, expect, it } from "vitest";
import {
  buildTrSyncId,
  parseTrSuffix,
  isTrCashAccount,
  isLegacyEnvSyncId,
} from "@/lib/domain/sync-ids";

// Account.syncId is globally unique, so the shape of these strings is what
// decides whether two users can each connect their own Trade Republic account
// or silently overwrite each other's. The two shapes have to coexist: existing
// installs already hold `tr:cash` rows and must keep working untouched.

describe("buildTrSyncId", () => {
  it("keeps the legacy two-segment shape for the env-configured sync", () => {
    expect(buildTrSyncId("cash")).toBe("tr:cash");
    expect(buildTrSyncId("pea", null)).toBe("tr:pea");
  });

  it("namespaces by institution for the per-user path", () => {
    expect(buildTrSyncId("cash", "inst-123")).toBe("tr:inst-123:cash");
  });

  it("gives two users different ids for the same account kind", () => {
    // The whole point: without this they collide on a unique column and the
    // second sync overwrites the first user's account.
    expect(buildTrSyncId("cash", "inst-a")).not.toBe(buildTrSyncId("cash", "inst-b"));
  });
});

describe("parseTrSuffix", () => {
  it.each([
    ["tr:cash", "cash"],
    ["tr:cto", "cto"],
    ["tr:pea", "pea"],
    ["tr:crypto", "crypto"],
    ["tr:inst-123:cash", "cash"],
    ["tr:inst-123:pea", "pea"],
  ])("%s -> %s", (syncId, expected) => {
    expect(parseTrSuffix(syncId)).toBe(expected);
  });

  it.each([
    ["lcl:12345", "another sync's account"],
    ["woob:inst-1:9876", "a Woob account"],
    ["gocardless_abc", "a GoCardless transaction"],
    ["csv_uuid", "a CSV-imported transaction"],
    ["tr:unknown", "a suffix this app never writes"],
    ["tr:a:b:cash", "too many segments to be a shape we produce"],
    [null, "null"],
    [undefined, "undefined"],
    ["", "empty"],
  ])("%s is not a Trade Republic account (%s)", (syncId, why) => {
    expect(parseTrSuffix(syncId as string | null | undefined), why).toBeNull();
  });
});

describe("isTrCashAccount", () => {
  it("matches the cash account under both shapes", () => {
    // analytics.ts applies TR's own cash interest rate off this. It used to
    // compare against the literal "tr:cash", which would have silently stopped
    // matching for per-user accounts - no error, just an understated figure.
    expect(isTrCashAccount("tr:cash")).toBe(true);
    expect(isTrCashAccount("tr:inst-123:cash")).toBe(true);
  });

  it("does not match TR's other account kinds", () => {
    expect(isTrCashAccount("tr:pea")).toBe(false);
    expect(isTrCashAccount("tr:inst-123:cto")).toBe(false);
  });
});

describe("isLegacyEnvSyncId", () => {
  it.each(["lcl:12345", "tr:cash", "tr:pea"])("%s is an env-configured account", (id) => {
    expect(isLegacyEnvSyncId(id)).toBe(true);
  });

  it.each([
    ["tr:inst-123:cash", "per-user Trade Republic"],
    ["woob:inst-1:9876", "per-user Woob"],
    [null, "no sync id at all"],
  ])("%s is not (%s)", (id, why) => {
    // This set is what migrateDedicatedSyncToWoob deletes. A per-user Trade
    // Republic account landing in it would be offered up for migration and
    // then cascade-deleted with its whole history.
    expect(isLegacyEnvSyncId(id as string | null), why).toBe(false);
  });
});
