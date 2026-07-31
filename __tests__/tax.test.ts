import { describe, expect, it } from "vitest";
import { getAccountTaxRate } from "@/lib/domain/tax";

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
    // getAccountTaxRate is a pure passthrough here (no arithmetic on
    // taxRatePct), so this is an identity check on an unmodified literal,
    // not the "a + b === c" style float-drift risk the rule guards against.
    // eslint-disable-next-line sonarjs/no-floating-point-equality
    expect(getAccountTaxRate({ taxTreatment: "TAXABLE", taxRatePct: 0.172 })).toBe(0.172);
    // eslint-disable-next-line sonarjs/no-floating-point-equality
    expect(getAccountTaxRate({ taxTreatment: "TAXABLE", taxRatePct: 0.314 })).toBe(0.314);
  });

  it("returns null for a TAXABLE account with no rate set (shouldn't happen via the UI, but the type allows it)", () => {
    expect(getAccountTaxRate({ taxTreatment: "TAXABLE", taxRatePct: null })).toBeNull();
  });
});
