import { describe, expect, it } from "vitest";
import { getAccountTaxRate } from "@/lib/tax";

describe("getAccountTaxRate", () => {
  it("returns 0 for EXEMPT accounts regardless of taxRatePct", () => {
    expect(getAccountTaxRate({ taxTreatment: "EXEMPT", taxRatePct: 0.314 })).toBe(0);
    expect(getAccountTaxRate({ taxTreatment: "EXEMPT", taxRatePct: null })).toBe(0);
  });

  it("returns 0 for DEFERRED accounts regardless of taxRatePct", () => {
    expect(getAccountTaxRate({ taxTreatment: "DEFERRED", taxRatePct: 0.314 })).toBe(0);
    expect(getAccountTaxRate({ taxTreatment: "DEFERRED", taxRatePct: null })).toBe(0);
  });

  it("returns the account's own rate for TAXABLE accounts", () => {
    expect(getAccountTaxRate({ taxTreatment: "TAXABLE", taxRatePct: 0.172 })).toBe(0.172);
    expect(getAccountTaxRate({ taxTreatment: "TAXABLE", taxRatePct: 0.314 })).toBe(0.314);
  });

  it("returns null for a TAXABLE account with no rate set (shouldn't happen via the UI, but the type allows it)", () => {
    expect(getAccountTaxRate({ taxTreatment: "TAXABLE", taxRatePct: null })).toBeNull();
  });
});
