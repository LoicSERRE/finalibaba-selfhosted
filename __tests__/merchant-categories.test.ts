import { describe, expect, it } from "vitest";
import { matchMerchantCategory } from "@/lib/domain/merchant-categories";

describe("matchMerchantCategory", () => {
  it("matches a well-known merchant regardless of surrounding bank boilerplate", () => {
    const match = matchMerchantCategory("CB CARREFOUR MARKET 01/02 PARIS");
    expect(match?.categoryName).toBe("Alimentation");
    expect(match?.color).toBe("#22c55e");
  });

  it("is case-insensitive", () => {
    expect(matchMerchantCategory("netflix.com")?.categoryName).toBe("Abonnements");
    expect(matchMerchantCategory("NETFLIX.COM")?.categoryName).toBe("Abonnements");
  });

  it("returns null for a label matching no known pattern", () => {
    expect(matchMerchantCategory("Virement de Jean Dupont")).toBeNull();
  });

  it("matches transport brands", () => {
    expect(matchMerchantCategory("SNCF CONNECT")?.categoryName).toBe("Transport");
    expect(matchMerchantCategory("UBER *TRIP")?.categoryName).toBe("Transport");
  });

  it("matches subscription services", () => {
    expect(matchMerchantCategory("PRLV SEPA SPOTIFY")?.categoryName).toBe("Abonnements");
  });

  it("groups gym memberships under Abonnements, not a separate category - same 'recurring payment' grouping as streaming", () => {
    expect(matchMerchantCategory("PRLV BASIC FIT")?.categoryName).toBe("Abonnements");
  });

  it("folds restaurants into Alimentation rather than a separate category", () => {
    expect(matchMerchantCategory("MCDONALD'S PARIS 15")?.categoryName).toBe("Alimentation");
  });

  it("does not match a Trade Republic recurring investment purchase as the Spar supermarket chain - regression test for a real production bug", () => {
    // "Sparplan" (German for "savings plan") contains "spar" as a substring
    // - the "spar" pattern (Spar supermarket) was removed after this
    // silently mis-categorized every Trade Republic recurring buy
    // (crypto or stock) as Alimentation.
    expect(matchMerchantCategory("Bitcoin - Sparplan ausgeführt")).toBeNull();
    expect(matchMerchantCategory("MSCI World ETF - Sparplan ausgeführt")).toBeNull();
  });

  it("matches Trade Republic's own interest-payout label", () => {
    const match = matchMerchantCategory("Zinsen");
    expect(match?.categoryName).toBe("Revenus");
    expect(match?.color).toBe("#14b8a6");
  });
});
