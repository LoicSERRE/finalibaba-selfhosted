import { describe, expect, it } from "vitest";
import {
  TRADE_REPUBLIC_MODULE,
  TRADE_REPUBLIC_LABEL,
  bankPickerEntries,
  isTradeRepublicModule,
} from "@/lib/domain/sync-providers";

const WOOB = [
  { module: "lcl", label: "LCL" },
  { module: "boursorama", label: "Boursorama" },
  { module: "amundi", label: "Amundi" },
];

describe("bankPickerEntries", () => {
  it("offers Trade Republic alongside every Woob bank", () => {
    const labels = bankPickerEntries(WOOB).map((e) => e.label);
    expect(labels).toContain(TRADE_REPUBLIC_LABEL);
    expect(labels).toHaveLength(WOOB.length + 1);
  });

  it("sorts by label so the search list reads alphabetically", () => {
    expect(bankPickerEntries(WOOB).map((e) => e.label)).toEqual([
      "Amundi",
      "Boursorama",
      "LCL",
      "Trade Republic",
    ]);
  });

  it("keeps every Woob module reachable under its own value", () => {
    const entries = bankPickerEntries(WOOB);
    for (const w of WOOB) {
      expect(entries).toContainEqual(w);
    }
  });

  it("never lists Trade Republic twice if Woob ever ships a module for it", () => {
    // Woob has none today. If one appears, the native path is the one that
    // actually works, so it wins rather than leaving two identical-looking
    // entries whose behaviour silently differs.
    const entries = bankPickerEntries([...WOOB, { module: "traderepublic", label: "Trade Republic" }]);
    const tr = entries.filter((e) => e.label === TRADE_REPUBLIC_LABEL);
    expect(tr).toHaveLength(1);
    expect(tr[0].module).toBe(TRADE_REPUBLIC_MODULE);
  });

  it("matches that duplicate case-insensitively and ignoring surrounding space", () => {
    const entries = bankPickerEntries([{ module: "tr", label: "  trade republic " }]);
    expect(entries).toHaveLength(1);
    expect(entries[0].module).toBe(TRADE_REPUBLIC_MODULE);
  });

  it("works from an empty catalogue, which is what a fresh install with no sync service sees", () => {
    expect(bankPickerEntries([])).toEqual([
      { module: TRADE_REPUBLIC_MODULE, label: TRADE_REPUBLIC_LABEL },
    ]);
  });

  it("does not mutate the list it was given", () => {
    const original = [...WOOB];
    bankPickerEntries(WOOB);
    expect(WOOB).toEqual(original);
  });
});

describe("isTradeRepublicModule", () => {
  it("recognises the sentinel", () => {
    expect(isTradeRepublicModule(TRADE_REPUBLIC_MODULE)).toBe(true);
  });

  it.each([
    ["lcl", "a real Woob module"],
    ["__other__", "the add dialog's own escape hatch"],
    ["__custom__", "the configure dialog's escape hatch"],
    ["traderepublic", "a hypothetical Woob module name"],
    ["", "nothing picked yet"],
    [null, "null"],
    [undefined, "undefined"],
  ])("%s is not the sentinel (%s)", (value, why) => {
    // The sentinel is underscore-wrapped precisely so no Woob module name,
    // which are plain lowercase identifiers, can ever collide with it.
    expect(isTradeRepublicModule(value as string | null | undefined), why).toBe(false);
  });
});
