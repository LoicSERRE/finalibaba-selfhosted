import { describe, expect, it } from "vitest";
import {
  anchorBalanceFor,
  atNoonUtc,
  validateManualMovement,
  type BalanceSnapshot,
} from "@/lib/domain/manual-entries";

function snap(iso: string, cents: number): BalanceSnapshot {
  return { recordedAt: atNoonUtc(iso), balanceCents: BigInt(cents) };
}

describe("atNoonUtc", () => {
  it("lands at noon so a date never shifts a day under a negative UTC offset", () => {
    expect(atNoonUtc("2026-03-07").toISOString()).toBe("2026-03-07T12:00:00.000Z");
  });
});

describe("anchorBalanceFor", () => {
  it("adds the movement to the balance that preceded it", () => {
    const history = [snap("2026-01-01", 10_000)];
    expect(anchorBalanceFor(history, atNoonUtc("2026-01-05"), BigInt(-1_200))).toBe(BigInt(8_800));
  });

  it("starts from zero when the account has no history at all", () => {
    expect(anchorBalanceFor([], atNoonUtc("2026-01-05"), BigInt(5_000))).toBe(BigInt(5_000));
  });

  it("returns null when a row already sits on that instant, so it is shifted instead", () => {
    const history = [snap("2026-01-01", 10_000), snap("2026-01-05", 8_800)];
    expect(anchorBalanceFor(history, atNoonUtc("2026-01-05"), BigInt(-500))).toBeNull();
  });

  // The one genuinely error-prone case: a backdated entry must build on the
  // balance immediately BEFORE it, never on the latest row overall. Using the
  // latest would give 13800 - 500 here, silently inventing money.
  it("uses the balance strictly before a backdated entry, not the most recent one", () => {
    const history = [snap("2026-01-01", 10_000), snap("2026-01-05", 8_800), snap("2026-01-10", 13_800)];
    expect(anchorBalanceFor(history, atNoonUtc("2026-01-07"), BigInt(-500))).toBe(BigInt(8_300));
  });

  it("does not care what order the snapshots arrive in", () => {
    const shuffled = [snap("2026-01-10", 13_800), snap("2026-01-01", 10_000), snap("2026-01-05", 8_800)];
    expect(anchorBalanceFor(shuffled, atNoonUtc("2026-01-07"), BigInt(-500))).toBe(BigInt(8_300));
  });

  it("ignores rows after the entry entirely - they are shifted by the caller", () => {
    const history = [snap("2026-02-01", 99_999)];
    expect(anchorBalanceFor(history, atNoonUtc("2026-01-05"), BigInt(2_000))).toBe(BigInt(2_000));
  });
});

describe("validateManualMovement", () => {
  const ok = { amountCents: -1_250, label: "Boulangerie", date: "2026-01-05" };

  it("accepts a well-formed spend", () => {
    expect(validateManualMovement(ok)).toBeNull();
  });

  it("accepts a top-up", () => {
    expect(validateManualMovement({ ...ok, amountCents: 10_000 })).toBeNull();
  });

  // A future-dated entry would become the account's displayed balance on the
  // spot, since the balance shown is simply the newest row.
  it("rejects a future date", () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(validateManualMovement({ ...ok, date: tomorrow })).toBe("future_date");
  });

  it("accepts today", () => {
    expect(validateManualMovement({ ...ok, date: new Date().toISOString().slice(0, 10) })).toBeNull();
  });

  it("rejects a malformed date rather than coercing it", () => {
    expect(validateManualMovement({ ...ok, date: "05/01/2026" })).toBe("invalid_date");
  });

  it("rejects a zero amount, which would write a movement that moves nothing", () => {
    expect(validateManualMovement({ ...ok, amountCents: 0 })).toBe("amount_required");
  });

  it("rejects an amount that rounds to zero", () => {
    expect(validateManualMovement({ ...ok, amountCents: 0.4 })).toBe("amount_required");
  });

  it("rejects a blank label, so the ledger never shows an unexplained line", () => {
    expect(validateManualMovement({ ...ok, label: "   " })).toBe("label_required");
  });
});
