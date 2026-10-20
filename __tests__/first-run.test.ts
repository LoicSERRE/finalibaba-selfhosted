import { describe, expect, it } from "vitest";
import { checklistVariant, firstRunComplete, firstRunSteps, type FirstRunFacts } from "@/lib/domain/first-run";

/**
 * The first-run checklist (v2.17) is ticked by data. What matters: a fresh
 * instance has everything to do, each fact ticks exactly its own step, and
 * the optional bank connection never keeps the checklist open.
 */
const NONE: FirstRunFacts = { accounts: 0, syncedAccounts: 0, profileSet: false, categories: 0, goals: 0 };
const done = (f: FirstRunFacts) => firstRunSteps(f).filter((s) => s.done).map((s) => s.id);

describe("firstRunSteps", () => {
  it("starts with everything to do", () => {
    expect(done(NONE)).toEqual([]);
    expect(firstRunComplete(firstRunSteps(NONE))).toBe(false);
  });

  it("ticks each step from its own fact", () => {
    expect(done({ ...NONE, accounts: 1 })).toEqual(["account"]);
    expect(done({ ...NONE, syncedAccounts: 1 })).toEqual(["bank"]);
    expect(done({ ...NONE, profileSet: true })).toEqual(["profile"]);
    expect(done({ ...NONE, categories: 3 })).toEqual(["categories"]);
    expect(done({ ...NONE, goals: 1 })).toEqual(["goal"]);
  });

  it("is complete without a bank connection, never without a required step", () => {
    const allButBank = { accounts: 2, syncedAccounts: 0, profileSet: true, categories: 4, goals: 1 };
    expect(firstRunComplete(firstRunSteps(allButBank))).toBe(true);
    expect(firstRunComplete(firstRunSteps({ ...allButBank, goals: 0 }))).toBe(false);
  });

  it("links every step somewhere real", () => {
    for (const step of firstRunSteps(NONE)) expect(step.href.startsWith("/")).toBe(true);
  });
});

describe("checklistVariant", () => {
  const open = firstRunSteps(NONE);
  const complete = firstRunSteps({ accounts: 1, syncedAccounts: 0, profileSet: true, categories: 1, goals: 1 });

  // The bug this pins shipped in the first draft: with no account, the page
  // rendered the compact card AND the full one in the empty state's place.
  it("is the full checklist alone when there is no account, hidden or not", () => {
    expect(checklistVariant(open, false, false)).toBe("full");
    expect(checklistVariant(open, false, true)).toBe("full");
  });

  it("is compact above data until done or hidden", () => {
    expect(checklistVariant(open, true, false)).toBe("compact");
    expect(checklistVariant(open, true, true)).toBeNull();
    expect(checklistVariant(complete, true, false)).toBeNull();
  });

  it("is never shown on someone else's portfolio", () => {
    expect(checklistVariant(null, false, false)).toBeNull();
    expect(checklistVariant(null, true, false)).toBeNull();
  });
});
