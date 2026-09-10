import { describe, expect, it } from "vitest";
import { detectInternalTransferPairings } from "@/lib/domain/internal-transfers";
import type { TransferCandidate } from "@/lib/domain/internal-transfers";

/** The ids on either side of a detected pair - what the caller acts on. */
function detectInternalTransferPairs(txs: TransferCandidate[], toleranceDays?: number): Set<string> {
  const ids = new Set<string>();
  for (const p of detectInternalTransferPairings(txs, toleranceDays)) {
    ids.add(p.creditId);
    ids.add(p.debitId);
  }
  return ids;
}

describe("detectInternalTransferPairs", () => {
  it("matches a same-day, same-amount credit/debit pair on different accounts", () => {
    const result = detectInternalTransferPairs([
      { id: "credit1", accountId: "a2", amountCents: BigInt(250000), date: new Date("2026-07-04") },
      { id: "debit1", accountId: "a1", amountCents: BigInt(-250000), date: new Date("2026-07-04") },
    ]);
    expect(result).toEqual(new Set(["credit1", "debit1"]));
  });

  it("matches within the date tolerance, not just the exact same day", () => {
    const result = detectInternalTransferPairs([
      { id: "credit1", accountId: "a2", amountCents: BigInt(10000), date: new Date("2026-07-04") },
      { id: "debit1", accountId: "a1", amountCents: BigInt(-10000), date: new Date("2026-07-06") },
    ]);
    expect(result).toEqual(new Set(["credit1", "debit1"]));
  });

  it("does not match beyond the date tolerance", () => {
    const result = detectInternalTransferPairs([
      { id: "credit1", accountId: "a2", amountCents: BigInt(10000), date: new Date("2026-07-01") },
      { id: "debit1", accountId: "a1", amountCents: BigInt(-10000), date: new Date("2026-07-10") },
    ]);
    expect(result.size).toBe(0);
  });

  it("does not match a credit and debit on the SAME account, even with equal amounts", () => {
    // Two unrelated transactions on one account that happen to cancel out
    // in amount are not a transfer "to another account" by definition.
    const result = detectInternalTransferPairs([
      { id: "credit1", accountId: "a1", amountCents: BigInt(5000), date: new Date("2026-07-04") },
      { id: "debit1", accountId: "a1", amountCents: BigInt(-5000), date: new Date("2026-07-04") },
    ]);
    expect(result.size).toBe(0);
  });

  it("leaves a credit unmatched when no opposite-amount debit exists on another account", () => {
    const result = detectInternalTransferPairs([
      { id: "credit1", accountId: "a2", amountCents: BigInt(144445), date: new Date("2026-01-29") }, // e.g. a real salary payment
    ]);
    expect(result.size).toBe(0);
  });

  it("picks the closest-dated debit when multiple candidates share the same amount", () => {
    const result = detectInternalTransferPairs([
      { id: "credit1", accountId: "a2", amountCents: BigInt(5000), date: new Date("2026-07-05") },
      { id: "debitFar", accountId: "a1", amountCents: BigInt(-5000), date: new Date("2026-07-01") },
      { id: "debitClose", accountId: "a1", amountCents: BigInt(-5000), date: new Date("2026-07-04") },
    ]);
    expect(result.has("debitClose")).toBe(true);
    expect(result.has("debitFar")).toBe(false);
  });

  it("does not reuse the same debit for two different credits", () => {
    const result = detectInternalTransferPairs([
      { id: "credit1", accountId: "a2", amountCents: BigInt(5000), date: new Date("2026-07-04") },
      { id: "credit2", accountId: "a3", amountCents: BigInt(5000), date: new Date("2026-07-05") },
      { id: "debit1", accountId: "a1", amountCents: BigInt(-5000), date: new Date("2026-07-04") },
    ]);
    // Only one pair can form - the other credit stays unmatched.
    const matchedCredits = ["credit1", "credit2"].filter((id) => result.has(id));
    expect(matchedCredits).toHaveLength(1);
    expect(result.has("debit1")).toBe(true);
  });

  it("prefers the globally closest-dated pair over whichever credit happens to be listed first", () => {
    // Real production bug: an unrelated same-amount credit a few days off
    // must not be allowed to claim the debit that an exact same-day credit
    // (listed later in the array) was the true match for. Order in the
    // input array must never affect which pair wins - only date closeness
    // should.
    const result = detectInternalTransferPairs([
      { id: "creditFewDaysOff", accountId: "a2", amountCents: BigInt(50000), date: new Date("2026-06-27") },
      { id: "debitShared", accountId: "a1", amountCents: BigInt(-50000), date: new Date("2026-06-30") },
      { id: "creditSameDay", accountId: "a3", amountCents: BigInt(50000), date: new Date("2026-06-30") },
    ]);
    expect(result.has("creditSameDay")).toBe(true);
    expect(result.has("debitShared")).toBe(true);
    expect(result.has("creditFewDaysOff")).toBe(false);
  });

  it("pairs up as many legs as the candidates allow, not as many as closeness suggests", () => {
    // Measured on a real account: 1200 EUR left a Livret, landed on the
    // current account, and went on to a broker the next day. Four legs, four
    // valid candidate pairs. Assigning the closest pair first hands the
    // Livret debit to the broker credit - same day, so it wins - and both
    // current-account legs are then left to count as ordinary spending and
    // income, one pair where two were available.
    const result = detectInternalTransferPairings([
      { id: "currentIn", accountId: "current", amountCents: BigInt(120000), date: new Date("2026-02-13") },
      { id: "currentOut", accountId: "current", amountCents: BigInt(-120000), date: new Date("2026-02-13") },
      { id: "livretOut", accountId: "livret", amountCents: BigInt(-120000), date: new Date("2026-02-14") },
      { id: "brokerIn", accountId: "broker", amountCents: BigInt(120000), date: new Date("2026-02-14") },
    ]);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ creditId: "currentIn", debitId: "livretOut" });
    expect(result).toContainEqual({ creditId: "brokerIn", debitId: "currentOut" });
  });

  it("real-world example: LCL's generic 'VIREMENT SEPA' label reused for both an internal transfer and unrelated payments", () => {
    // Mirrors data seen in production: a 2500€ internal transfer between
    // "Compte perso" and "Livret A", alongside an unrelated salary-like
    // credit with no matching debit anywhere.
    const result = detectInternalTransferPairs([
      { id: "internalCredit", accountId: "compte-perso", amountCents: BigInt(250000), date: new Date("2026-07-04") },
      { id: "internalDebit", accountId: "livret-a", amountCents: BigInt(-250000), date: new Date("2026-07-04") },
      { id: "salary", accountId: "compte-perso", amountCents: BigInt(144445), date: new Date("2026-01-29") },
    ]);
    expect(result.has("internalCredit")).toBe(true);
    expect(result.has("internalDebit")).toBe(true);
    expect(result.has("salary")).toBe(false);
  });
});

describe("detectInternalTransferPairings", () => {
  it("says which credit went with which debit, not just who was involved", () => {
    // The caller stores this. Without it a later pass can tell that a row is
    // flagged but not what justified it, which is the only thing that makes
    // revoking a flag safe rather than a guess.
    const result = detectInternalTransferPairings([
      { id: "credit1", accountId: "a2", amountCents: BigInt(250000), date: new Date("2026-07-04") },
      { id: "debit1", accountId: "a1", amountCents: BigInt(-250000), date: new Date("2026-07-04") },
    ]);
    expect(result).toEqual([{ creditId: "credit1", debitId: "debit1" }]);
  });

  it("keeps the closest-first assignment the flattened form has always had", () => {
    // debit1 sits between two same-amount credits; the same-day one wins and
    // the looser one is left unpaired rather than stealing it.
    const result = detectInternalTransferPairings([
      { id: "far", accountId: "a2", amountCents: BigInt(10000), date: new Date("2026-07-06") },
      { id: "debit1", accountId: "a1", amountCents: BigInt(-10000), date: new Date("2026-07-04") },
      { id: "near", accountId: "a3", amountCents: BigInt(10000), date: new Date("2026-07-04") },
    ]);
    expect(result).toEqual([{ creditId: "near", debitId: "debit1" }]);
  });

  it("returns nothing to store when nothing pairs", () => {
    expect(
      detectInternalTransferPairings([
        { id: "credit1", accountId: "a2", amountCents: BigInt(10000), date: new Date("2026-07-01") },
      ])
    ).toEqual([]);
  });
});
