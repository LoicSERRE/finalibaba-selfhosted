import { describe, expect, it } from "vitest";
import {
  COUNTRY_CODES,
  countryPreset,
  isCountryCode,
  suggestedSavingsRate,
  wrapperPreset,
} from "@/lib/domain/tax-locale";

/**
 * The point of this module is that the app stops assuming France. These tests
 * pin the two properties that make that true: an unset country inherits
 * nothing French, and every country's wrappers still map onto the three
 * treatments the rest of the app actually computes with.
 */

describe("an unset or unknown country inherits nothing from France", () => {
  it("suggests no savings rate", () => {
    // The exact regression: "Livret A" is a French product name, and the old
    // code matched it on account name regardless of where the user lived.
    expect(suggestedSavingsRate(null, "Livret A")).toBeNull();
    expect(suggestedSavingsRate(undefined, "Livret A")).toBeNull();
    expect(suggestedSavingsRate("OTHER", "Livret A")).toBeNull();
    expect(suggestedSavingsRate("ZZ", "Livret A")).toBeNull();
  });

  it("offers neutral wrappers, not PEA/CTO", () => {
    const keys = countryPreset(null).wrappers.map((w) => w.key);
    expect(keys).not.toContain("PEA");
    expect(keys).not.toContain("CTO");
    expect(keys.length).toBeGreaterThan(0);
  });

  it("suggests no default taxable rate", () => {
    expect(countryPreset(null).defaultTaxablePct).toBeNull();
  });
});

describe("France keeps exactly the behaviour it had", () => {
  // An upgrading instance must see identical figures - the migration backfills
  // from these same numbers, so a drift here is a drift in real net worth.
  it.each([
    ["Livret A", 0.015],
    ["LDDS", 0.015],
    ["LEP", 0.025],
    ["Livret Jeune", 0.025],
  ])("%s -> %s", (name, rate) => {
    expect(suggestedSavingsRate("FR", name)).toBeCloseTo(rate, 10);
  });

  it("matches case-insensitively, like the code it replaces", () => {
    expect(suggestedSavingsRate("FR", "LIVRET A - BNP")).toBeCloseTo(0.015, 10);
    expect(suggestedSavingsRate("FR", "mon ldds")).toBeCloseTo(0.015, 10);
  });

  it("prefers the more specific product over the generic livret rule", () => {
    // "Livret Jeune" contains "livret"; the looser rule must not win, or a
    // 2.5% account would silently be valued at 1.5%.
    expect(suggestedSavingsRate("FR", "Livret Jeune")).toBeCloseTo(0.025, 10);
  });

  it("falls back to the regulated rate for any other livret", () => {
    expect(suggestedSavingsRate("FR", "Livret Bleu")).toBeCloseTo(0.015, 10);
  });

  it("says nothing about an account that is not a regulated product", () => {
    expect(suggestedSavingsRate("FR", "Compte courant")).toBeNull();
    expect(suggestedSavingsRate("FR", "Épargne Boursorama")).toBeNull();
  });
});

describe("every country's presets are usable by the rest of the app", () => {
  it.each(COUNTRY_CODES)("%s", (code) => {
    const preset = countryPreset(code);
    expect(preset.wrappers.length).toBeGreaterThan(0);
    for (const w of preset.wrappers) {
      // getAccountTaxRate only understands these three.
      expect(["EXEMPT", "DEFERRED", "TAXABLE"]).toContain(w.treatment);
      // A rate is either absent or a real 0-1 ratio - never a percentage that
      // would be silently multiplied by 100 somewhere downstream.
      if (w.ratePct !== null) {
        expect(w.ratePct).toBeGreaterThanOrEqual(0);
        expect(w.ratePct).toBeLessThanOrEqual(1);
      }
    }
    if (preset.defaultTaxablePct !== null) {
      expect(preset.defaultTaxablePct).toBeGreaterThanOrEqual(0);
      expect(preset.defaultTaxablePct).toBeLessThanOrEqual(1);
    }
  });

  it("never attaches a rate to an exempt wrapper", () => {
    // A rate on an EXEMPT wrapper is contradictory: getAccountTaxRate returns
    // 0 for it regardless, so a stored number would be a lie on screen.
    for (const code of COUNTRY_CODES) {
      for (const w of countryPreset(code).wrappers) {
        if (w.treatment === "EXEMPT") expect(w.ratePct).toBeNull();
      }
    }
  });

  it("gives every country at least one wrapper for untaxed long-term saving", () => {
    // Pension-style accounts exist everywhere; if a country listed none, its
    // users would have to mis-file a pension as a taxable brokerage account.
    for (const code of COUNTRY_CODES) {
      const treatments = countryPreset(code).wrappers.map((w) => w.treatment);
      expect(treatments.some((t) => t === "EXEMPT" || t === "DEFERRED")).toBe(true);
    }
  });
});

describe("wrapperPreset", () => {
  it("resolves a stored subtype back to its treatment", () => {
    expect(wrapperPreset("FR", "PEA")?.treatment).toBe("EXEMPT");
    expect(wrapperPreset("GB", "ISA")?.treatment).toBe("EXEMPT");
    expect(wrapperPreset("US", "401(k)")?.treatment).toBe("DEFERRED");
  });

  it("returns null for a wrapper the country does not have", () => {
    // A user who moves country keeps their old accounts; the label simply no
    // longer resolves, which must not throw.
    expect(wrapperPreset("GB", "PEA")).toBeNull();
    expect(wrapperPreset("FR", null)).toBeNull();
  });
});

describe("suggested savings rates carry the date they were known", () => {
  // A regulated rate is a fact with an expiry - France's Livret A has moved
  // repeatedly and is expected to again. An undated suggestion is
  // indistinguishable from a value the user verified, so the date is part of
  // the type and is shown next to the figure.
  it("every savings preset states when it was current", () => {
    for (const code of COUNTRY_CODES) {
      for (const p of countryPreset(code).savings) {
        expect(p.knownAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isNaN(Date.parse(p.knownAt))).toBe(false);
      }
    }
  });

  it("only lists national rates where they are actually set nationally", () => {
    // Everywhere but France, a savings rate is whatever your bank offers, so
    // suggesting one would be inventing a fact rather than recalling one.
    expect(countryPreset("FR").savings.length).toBeGreaterThan(0);
    for (const code of COUNTRY_CODES.filter((c) => c !== "FR")) {
      expect(countryPreset(code).savings).toEqual([]);
    }
  });
});

describe("isCountryCode", () => {
  it("accepts every listed code and rejects anything else", () => {
    for (const c of COUNTRY_CODES) expect(isCountryCode(c)).toBe(true);
    expect(isCountryCode("fr")).toBe(false); // stored uppercase, no coercion
    expect(isCountryCode("")).toBe(false);
    expect(isCountryCode(null)).toBe(false);
  });
});
