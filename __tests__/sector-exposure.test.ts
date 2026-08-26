import { describe, expect, it } from "vitest";
import { normalizeSectorKey, aggregateSectorExposure, MAX_CONTRIBUTIONS_PER_SECTOR } from "@/lib/domain/sector-exposure";

describe("normalizeSectorKey", () => {
  it("lowercases and underscores a Title Case label (Yahoo search's own sector field)", () => {
    expect(normalizeSectorKey("Technology")).toBe("technology");
    expect(normalizeSectorKey("Consumer Cyclical")).toBe("consumer_cyclical");
    expect(normalizeSectorKey("Financial Services")).toBe("financial_services");
  });

  it("passes an already snake_case key through unchanged (Yahoo topHoldings' own key set)", () => {
    expect(normalizeSectorKey("consumer_cyclical")).toBe("consumer_cyclical");
    expect(normalizeSectorKey("basic_materials")).toBe("basic_materials");
  });

  it("maps the real quirk found live: topHoldings' unbroken 'realestate' and search's 'Real Estate' to the same key", () => {
    expect(normalizeSectorKey("realestate")).toBe("real_estate");
    expect(normalizeSectorKey("Real Estate")).toBe("real_estate");
  });
});

describe("aggregateSectorExposure", () => {
  it("sums a single-sector stock (100% weight) into that one bucket", () => {
    const result = aggregateSectorExposure([
      { name: "Apple", marketValueCents: BigInt(1000_00), sectorWeights: { technology: 1 } },
    ]);
    expect(result.breakdown).toEqual({ technology: BigInt(1000_00) });
    expect(result.unclassifiedCents).toBe(BigInt(0));
    expect(result.totalCents).toBe(BigInt(1000_00));
  });

  it("splits an ETF's value proportionally across every sector it reports", () => {
    const result = aggregateSectorExposure([
      { name: "MSCI World", marketValueCents: BigInt(1000_00), sectorWeights: { technology: 0.6, healthcare: 0.4 } },
    ]);
    expect(result.breakdown.technology).toBe(BigInt(600_00));
    expect(result.breakdown.healthcare).toBe(BigInt(400_00));
  });

  it("sums the same sector across multiple holdings", () => {
    const result = aggregateSectorExposure([
      { name: "Apple", marketValueCents: BigInt(1000_00), sectorWeights: { technology: 1 } },
      { name: "S&P 500", marketValueCents: BigInt(500_00), sectorWeights: { technology: 0.5, energy: 0.5 } },
    ]);
    expect(result.breakdown.technology).toBe(BigInt(1000_00 + 250_00));
    expect(result.breakdown.energy).toBe(BigInt(250_00));
  });

  it("routes a holding with no resolved sector data (null) entirely into unclassifiedCents", () => {
    const result = aggregateSectorExposure([
      { name: "Apple", marketValueCents: BigInt(1000_00), sectorWeights: { technology: 1 } },
      { name: "Obscure Fund", marketValueCents: BigInt(300_00), sectorWeights: null },
    ]);
    expect(result.unclassifiedCents).toBe(BigInt(300_00));
    expect(result.totalCents).toBe(BigInt(1300_00));
    expect(result.breakdown.technology).toBe(BigInt(1000_00));
  });

  it("treats an empty sectorWeights object the same as null (unclassified, not a silent 0)", () => {
    const result = aggregateSectorExposure([{ name: "Obscure Fund", marketValueCents: BigInt(500_00), sectorWeights: {} }]);
    expect(result.unclassifiedCents).toBe(BigInt(500_00));
    expect(result.breakdown).toEqual({});
  });

  it("normalizes casing while aggregating, so the same sector from different sources merges into one bucket", () => {
    const result = aggregateSectorExposure([
      { name: "Apple", marketValueCents: BigInt(600_00), sectorWeights: { Technology: 1 } }, // Yahoo search casing
      { name: "MSCI World", marketValueCents: BigInt(400_00), sectorWeights: { technology: 1 } }, // Yahoo topHoldings casing
    ]);
    expect(result.breakdown).toEqual({ technology: BigInt(1000_00) });
  });

  it("returns zeroed totals and empty contributions for an empty portfolio", () => {
    const result = aggregateSectorExposure([]);
    expect(result).toEqual({ breakdown: {}, contributions: {}, unclassifiedCents: BigInt(0), totalCents: BigInt(0) });
  });

  describe("contributions", () => {
    it("lists which holdings make up a sector, sorted by contribution descending", () => {
      const result = aggregateSectorExposure([
        { name: "Small Stake", marketValueCents: BigInt(100_00), sectorWeights: { technology: 1 } },
        { name: "Apple", marketValueCents: BigInt(1000_00), sectorWeights: { technology: 1 } },
        { name: "MSCI World", marketValueCents: BigInt(500_00), sectorWeights: { technology: 0.5, healthcare: 0.5 } },
      ]);
      expect(result.contributions.technology.holdings.map((h) => h.name)).toEqual(["Apple", "MSCI World", "Small Stake"]);
      expect(result.contributions.technology.holdings[1].cents).toBe(BigInt(250_00)); // MSCI World's 50% tech slice
      expect(result.contributions.healthcare.holdings).toEqual([{ name: "MSCI World", cents: BigInt(250_00) }]);
    });

    it(`caps each sector's contribution list at MAX_CONTRIBUTIONS_PER_SECTOR (${MAX_CONTRIBUTIONS_PER_SECTOR}) and flags truncation`, () => {
      const holdings = Array.from({ length: MAX_CONTRIBUTIONS_PER_SECTOR + 2 }, (_, i) => ({
        name: `Holding ${i}`,
        marketValueCents: BigInt((i + 1) * 100_00), // distinct values so sort order is deterministic
        sectorWeights: { technology: 1 },
      }));
      const result = aggregateSectorExposure(holdings);
      expect(result.contributions.technology.holdings).toHaveLength(MAX_CONTRIBUTIONS_PER_SECTOR);
      expect(result.contributions.technology.truncated).toBe(true);
      // the two smallest holdings (0 and 1) should have been dropped, not the largest
      const names = result.contributions.technology.holdings.map((h) => h.name);
      expect(names).not.toContain("Holding 0");
      expect(names).not.toContain("Holding 1");
    });

    it("does not flag truncation when the list fits within the cap", () => {
      const result = aggregateSectorExposure([{ name: "Apple", marketValueCents: BigInt(100_00), sectorWeights: { technology: 1 } }]);
      expect(result.contributions.technology.truncated).toBe(false);
    });

    it("lists unresolved holdings under the 'unclassified' contribution key", () => {
      const result = aggregateSectorExposure([
        { name: "Obscure Fund", marketValueCents: BigInt(300_00), sectorWeights: null },
      ]);
      expect(result.contributions.unclassified.holdings).toEqual([{ name: "Obscure Fund", cents: BigInt(300_00) }]);
    });
  });
});
