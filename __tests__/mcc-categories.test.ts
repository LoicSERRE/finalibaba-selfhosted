import { describe, expect, it } from "vitest";
import { matchMccCategory } from "@/lib/domain/mcc-categories";

describe("matchMccCategory", () => {
  it("maps a known MCC code to its category", () => {
    expect(matchMccCategory("5411")).toBe("Alimentation"); // Grocery Stores, Supermarkets
    expect(matchMccCategory("5812")).toBe("Alimentation"); // Eating places and Restaurants - folded into Alimentation, not a separate category
    expect(matchMccCategory("4121")).toBe("Transport"); // Taxicabs and Limousines
    expect(matchMccCategory("5734")).toBe("Shopping"); // Computer Software Stores
    expect(matchMccCategory("6300")).toBe("Abonnements"); // Insurance - recurring premiums fold into Abonnements
  });

  it("returns null for an unmapped code", () => {
    expect(matchMccCategory("9999")).toBeNull();
  });

  it("deliberately does not map cash disbursement or wire transfer codes", () => {
    expect(matchMccCategory("6011")).toBeNull(); // ATM withdrawal
    expect(matchMccCategory("4829")).toBeNull(); // wire transfer / money order
  });

  it("returns null for null or undefined (a transaction with no MCC set)", () => {
    expect(matchMccCategory(null)).toBeNull();
    expect(matchMccCategory(undefined)).toBeNull();
  });
});
