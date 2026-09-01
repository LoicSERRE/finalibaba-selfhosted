import { describe, expect, it } from "vitest";
import {
  isPerUserTrSource,
  isRealtimeSource,
  sourceInstitutionId,
  trRealtimeSource,
  SOURCE_LCL,
  SOURCE_TRADE_REPUBLIC,
  SOURCE_TRADE_REPUBLIC_REALTIME,
} from "@/lib/domain/sync-sources";

// SyncLog.source decides two things that are easy to get wrong quietly: whose
// row a sync writes (sync/db.py derives the userId from this string), and what
// a failure notification is titled. v2.1 added two per-user sources and taught
// neither reader about them.

const INST = "cmqpvbok0000abcdef";

describe("sourceInstitutionId", () => {
  it("returns null for the env-configured sources, which belong to the owner", () => {
    expect(sourceInstitutionId(SOURCE_LCL)).toBeNull();
    expect(sourceInstitutionId(SOURCE_TRADE_REPUBLIC)).toBeNull();
    expect(sourceInstitutionId(SOURCE_TRADE_REPUBLIC_REALTIME)).toBeNull();
  });

  it("reads the institution out of a Woob source", () => {
    expect(sourceInstitutionId(`woob:${INST}`)).toBe(INST);
  });

  it("reads the institution out of a per-user Trade Republic source", () => {
    // The gap this whole module exists for: only `woob:` was ever parsed, so
    // this returned nothing and the row fell back to the instance owner.
    expect(sourceInstitutionId(`tr:${INST}`)).toBe(INST);
  });

  it("reads the institution out of a listener source", () => {
    expect(sourceInstitutionId(trRealtimeSource(INST))).toBe(INST);
  });

  it("refuses a source carrying more than an id, rather than guessing", () => {
    // Matches sync/db.py's own conservative reading. A shape nothing writes
    // must not be attributed to whoever happens to own the first segment.
    expect(sourceInstitutionId(`tr:${INST}:realtime`)).toBeNull();
    expect(sourceInstitutionId(`woob:${INST}:extra`)).toBeNull();
  });

  it("refuses an empty id", () => {
    expect(sourceInstitutionId("tr:")).toBeNull();
    expect(sourceInstitutionId("woob:")).toBeNull();
  });

  it("returns null for anything it does not recognise", () => {
    expect(sourceInstitutionId("yahoo_sector_data")).toBeNull();
    expect(sourceInstitutionId("")).toBeNull();
  });
});

describe("the listener prefix does not collide with the sync prefix", () => {
  // The reason tr-realtime: is a sibling of tr: rather than nested inside it.
  it("a listener source is not read as a batch-sync source", () => {
    expect(isPerUserTrSource(trRealtimeSource(INST))).toBe(false);
  });

  it("a batch-sync source is not read as a listener source", () => {
    expect(isRealtimeSource(`tr:${INST}`)).toBe(false);
  });

  it("both still resolve to the same institution", () => {
    expect(sourceInstitutionId(`tr:${INST}`)).toBe(sourceInstitutionId(trRealtimeSource(INST)));
  });
});

describe("isRealtimeSource", () => {
  it("covers the env listener", () => {
    expect(isRealtimeSource(SOURCE_TRADE_REPUBLIC_REALTIME)).toBe(true);
  });

  it("covers a per-user listener", () => {
    expect(isRealtimeSource(trRealtimeSource(INST))).toBe(true);
  });

  it("does not cover a real sync source", () => {
    expect(isRealtimeSource(SOURCE_LCL)).toBe(false);
    expect(isRealtimeSource(SOURCE_TRADE_REPUBLIC)).toBe(false);
    expect(isRealtimeSource(`woob:${INST}`)).toBe(false);
  });
});
