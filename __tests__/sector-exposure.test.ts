import { describe, expect, it } from "vitest";
import { normalizeSectorKey, aggregateSectorExposure } from "@/lib/domain/sector-exposure";

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
      { marketValueCents: BigInt(1000_00), sectorWeights: { technology: 1 } },
    ]);
    expect(result.breakdown).toEqual({ technology: BigInt(1000_00) });
    expect(result.unclassifiedCents).toBe(BigInt(0));
    expect(result.totalCents).toBe(BigInt(1000_00));
  });

  it("splits an ETF's value proportionally across every sector it reports", () => {
    const result = aggregateSectorExposure([
      { marketValueCents: BigInt(1000_00), sectorWeights: { technology: 0.6, healthcare: 0.4 } },
    ]);
    expect(result.breakdown.technology).toBe(BigInt(600_00));
    expect(result.breakdown.healthcare).toBe(BigInt(400_00));
  });

  it("sums the same sector across multiple holdings", () => {
    const result = aggregateSectorExposure([
      { marketValueCents: BigInt(1000_00), sectorWeights: { technology: 1 } },
      { marketValueCents: BigInt(500_00), sectorWeights: { technology: 0.5, energy: 0.5 } },
    ]);
    expect(result.breakdown.technology).toBe(BigInt(1000_00 + 250_00));
    expect(result.breakdown.energy).toBe(BigInt(250_00));
  });

  it("routes a holding with no resolved sector data (null) entirely into unclassifiedCents", () => {
    const result = aggregateSectorExposure([
      { marketValueCents: BigInt(1000_00), sectorWeights: { technology: 1 } },
      { marketValueCents: BigInt(300_00), sectorWeights: null },
    ]);
    expect(result.unclassifiedCents).toBe(BigInt(300_00));
    expect(result.totalCents).toBe(BigInt(1300_00));
    expect(result.breakdown.technology).toBe(BigInt(1000_00));
  });

  it("treats an empty sectorWeights object the same as null (unclassified, not a silent 0)", () => {
    const result = aggregateSectorExposure([{ marketValueCents: BigInt(500_00), sectorWeights: {} }]);
    expect(result.unclassifiedCents).toBe(BigInt(500_00));
    expect(result.breakdown).toEqual({});
  });

  it("normalizes casing while aggregating, so the same sector from different sources merges into one bucket", () => {
    const result = aggregateSectorExposure([
      { marketValueCents: BigInt(600_00), sectorWeights: { Technology: 1 } }, // Yahoo search casing
      { marketValueCents: BigInt(400_00), sectorWeights: { technology: 1 } }, // Yahoo topHoldings casing
    ]);
    expect(result.breakdown).toEqual({ technology: BigInt(1000_00) });
  });

  it("returns zeroed totals for an empty portfolio", () => {
    const result = aggregateSectorExposure([]);
    expect(result).toEqual({ breakdown: {}, unclassifiedCents: BigInt(0), totalCents: BigInt(0) });
  });
});
