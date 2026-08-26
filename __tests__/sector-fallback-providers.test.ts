import { describe, expect, it } from "vitest";
import {
  parseFmpSectorWeightings,
  parseAlphaVantageSectorWeightings,
  normalizeAlphaVantageSector,
} from "@/lib/services/sector-fallback-providers";

// Fixture shaped per FMP's own public documentation for
// /api/v3/etf-sector-weightings/{symbol} (never live-confirmed - see the
// honesty note in sector-fallback-providers.ts's top-of-file comment).
const FMP_FIXTURE = [
  { sector: "Technology", weightPercentage: "45.20%" },
  { sector: "Financial Services", weightPercentage: "12.10%" },
  { sector: "Healthcare", weightPercentage: "10.00%" },
];

// Fixture shaped per a real, live-confirmed Alpha Vantage ETF_PROFILE
// response for QQQ (public `demo` key) - real GICS names, in the casing
// Alpha Vantage actually returns them in.
const ALPHA_VANTAGE_FIXTURE = {
  sectors: [
    { sector: "INFORMATION TECHNOLOGY", weight: "0.4834" },
    { sector: "CONSUMER DISCRETIONARY", weight: "0.1721" },
    { sector: "CONSUMER STAPLES", weight: "0.0623" },
    { sector: "FINANCIALS", weight: "0.0312" },
    { sector: "MATERIALS", weight: "0.0104" },
    { sector: "HEALTHCARE", weight: "0.0715" },
  ],
};

describe("parseFmpSectorWeightings", () => {
  it("parses a well-formed response into normalized 0-1 weights", () => {
    const result = parseFmpSectorWeightings(FMP_FIXTURE);
    expect(result).toEqual({
      technology: 0.452,
      financial_services: 0.121,
      healthcare: 0.1,
    });
  });

  it("returns null for a non-array response", () => {
    expect(parseFmpSectorWeightings({ sector: "Technology" })).toBeNull();
    expect(parseFmpSectorWeightings(null)).toBeNull();
    expect(parseFmpSectorWeightings(undefined)).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(parseFmpSectorWeightings([])).toBeNull();
  });

  it("skips entries with a missing sector or an unparseable/zero weight", () => {
    const result = parseFmpSectorWeightings([
      { sector: "Technology", weightPercentage: "45.20%" },
      { sector: undefined, weightPercentage: "10.00%" },
      { sector: "Energy", weightPercentage: "not-a-number" },
      { sector: "Utilities", weightPercentage: "0.00%" },
    ]);
    expect(result).toEqual({ technology: 0.452 });
  });

  it("returns null when every entry is skipped", () => {
    expect(parseFmpSectorWeightings([{ sector: undefined, weightPercentage: "10%" }])).toBeNull();
  });
});

describe("normalizeAlphaVantageSector", () => {
  it("aliases the 4 sectors whose Alpha Vantage wording differs from Yahoo's", () => {
    expect(normalizeAlphaVantageSector("INFORMATION TECHNOLOGY")).toBe("technology");
    expect(normalizeAlphaVantageSector("CONSUMER DISCRETIONARY")).toBe("consumer_cyclical");
    expect(normalizeAlphaVantageSector("CONSUMER STAPLES")).toBe("consumer_defensive");
    expect(normalizeAlphaVantageSector("FINANCIALS")).toBe("financial_services");
    expect(normalizeAlphaVantageSector("MATERIALS")).toBe("basic_materials");
  });

  it("falls through to normalizeSectorKey for sectors that already match Yahoo's wording", () => {
    expect(normalizeAlphaVantageSector("HEALTHCARE")).toBe("healthcare");
    expect(normalizeAlphaVantageSector("Real Estate")).toBe("real_estate");
  });

  it("is case-insensitive on the alias lookup", () => {
    expect(normalizeAlphaVantageSector("Information Technology")).toBe("technology");
  });
});

describe("parseAlphaVantageSectorWeightings", () => {
  it("parses a real live-confirmed QQQ-shaped response into normalized 0-1 weights", () => {
    const result = parseAlphaVantageSectorWeightings(ALPHA_VANTAGE_FIXTURE);
    expect(result).toEqual({
      technology: 0.4834,
      consumer_cyclical: 0.1721,
      consumer_defensive: 0.0623,
      financial_services: 0.0312,
      basic_materials: 0.0104,
      healthcare: 0.0715,
    });
  });

  it("returns null when the sectors key is missing or empty", () => {
    expect(parseAlphaVantageSectorWeightings({})).toBeNull();
    expect(parseAlphaVantageSectorWeightings({ sectors: [] })).toBeNull();
    expect(parseAlphaVantageSectorWeightings(undefined)).toBeNull();
  });

  it("skips entries with a missing sector or an unparseable/zero weight", () => {
    const result = parseAlphaVantageSectorWeightings({
      sectors: [
        { sector: "HEALTHCARE", weight: "0.10" },
        { sector: undefined, weight: "0.20" },
        { sector: "ENERGY", weight: "not-a-number" },
        { sector: "UTILITIES", weight: "0" },
      ],
    });
    expect(result).toEqual({ healthcare: 0.1 });
  });
});
