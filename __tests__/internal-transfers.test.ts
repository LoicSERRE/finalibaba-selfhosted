import { describe, expect, it } from "vitest";
import { detectInternalTransferPairs } from "@/lib/domain/internal-transfers";

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

  it("greedily picks the closest-dated debit when multiple candidates share the same amount", () => {
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
