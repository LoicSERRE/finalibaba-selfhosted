import { describe, expect, it } from "vitest";
import { suggestCategoryAssignments, normalizeLabelForCategorization } from "@/lib/domain/auto-categorize";

describe("suggestCategoryAssignments", () => {
  it("suggests nothing when there is no history at all", () => {
    const result = suggestCategoryAssignments([{ id: "t1", accountId: "a1", label: "Carrefour" }], []);
    expect(result.size).toBe(0);
  });

  it("suggests nothing when a label has been seen only once (below MIN_HISTORY_OCCURRENCES)", () => {
    const result = suggestCategoryAssignments(
      [{ id: "t1", accountId: "a1", label: "Carrefour" }],
      [{ accountId: "a1", label: "Carrefour", categoryId: "groceries" }]
    );
    expect(result.size).toBe(0);
  });

  it("suggests the category once a label has 2+ consistent prior occurrences", () => {
    const result = suggestCategoryAssignments(
      [{ id: "t1", accountId: "a1", label: "Carrefour" }],
      [
        { accountId: "a1", label: "Carrefour", categoryId: "groceries" },
        { accountId: "a1", label: "Carrefour", categoryId: "groceries" },
      ]
    );
    expect(result.get("t1")).toBe("groceries");
  });

  it("suggests nothing when the label's history is too inconsistent (below MIN_CONSISTENCY_RATIO)", () => {
    // 2 out of 4 = 50%, below the 70% threshold - a genuinely mixed-use
    // label (e.g. a payment processor covering several real merchants)
    // shouldn't get auto-categorized into whichever category happens to be
    // a bare plurality.
    const result = suggestCategoryAssignments(
      [{ id: "t1", accountId: "a1", label: "PayPal" }],
      [
        { accountId: "a1", label: "PayPal", categoryId: "groceries" },
        { accountId: "a1", label: "PayPal", categoryId: "groceries" },
        { accountId: "a1", label: "PayPal", categoryId: "leisure" },
        { accountId: "a1", label: "PayPal", categoryId: "shopping" },
      ]
    );
    expect(result.size).toBe(0);
  });

  it("suggests the majority category once it clears MIN_CONSISTENCY_RATIO", () => {
    // 3 out of 4 = 75%, above the 70% threshold.
    const result = suggestCategoryAssignments(
      [{ id: "t1", accountId: "a1", label: "Carrefour" }],
      [
        { accountId: "a1", label: "Carrefour", categoryId: "groceries" },
        { accountId: "a1", label: "Carrefour", categoryId: "groceries" },
        { accountId: "a1", label: "Carrefour", categoryId: "groceries" },
        { accountId: "a1", label: "Carrefour", categoryId: "leisure" },
      ]
    );
    expect(result.get("t1")).toBe("groceries");
  });

  it("normalizes labels the same way recurring-transaction detection does (trim + lowercase)", () => {
    const result = suggestCategoryAssignments(
      [{ id: "t1", accountId: "a1", label: "  CARREFOUR  " }],
      [
        { accountId: "a1", label: "carrefour", categoryId: "groceries" },
        { accountId: "a1", label: "Carrefour", categoryId: "groceries" },
      ]
    );
    expect(result.get("t1")).toBe("groceries");
  });

  it("scopes history per account - a label consistently categorized on one account doesn't leak to another", () => {
    const result = suggestCategoryAssignments(
      [{ id: "t1", accountId: "a2", label: "Carrefour" }],
      [
        { accountId: "a1", label: "Carrefour", categoryId: "groceries" },
        { accountId: "a1", label: "Carrefour", categoryId: "groceries" },
      ]
    );
    expect(result.size).toBe(0);
  });

  it("leaves genuinely new labels out of the result entirely, not mapped to null", () => {
    const result = suggestCategoryAssignments(
      [
        { id: "t1", accountId: "a1", label: "Carrefour" },
        { id: "t2", accountId: "a1", label: "Brand New Merchant" },
      ],
      [
        { accountId: "a1", label: "Carrefour", categoryId: "groceries" },
        { accountId: "a1", label: "Carrefour", categoryId: "groceries" },
      ]
    );
    expect(result.has("t1")).toBe(true);
    expect(result.has("t2")).toBe(false);
  });

  it("handles salary/dividend/interest labels identically to any other merchant label - no special-casing needed", () => {
    const result = suggestCategoryAssignments(
      [{ id: "t1", accountId: "a1", label: "Dividende AAPL" }],
      [
        { accountId: "a1", label: "Dividende AAPL", categoryId: "dividends" },
        { accountId: "a1", label: "Dividende AAPL", categoryId: "dividends" },
      ]
    );
    expect(result.get("t1")).toBe("dividends");
  });

  it("groups a French Livret's once-a-year interest label across years - regression test for a real user-reported gap", () => {
    // "INTERETS 2025"/"INTERETS 2026" would never accumulate 2 occurrences
    // of the *exact* same label under plain normalizeLabel, since the
    // label itself changes every year and interest is credited only once
    // a year - self-learning could never fire for this pattern otherwise.
    const result = suggestCategoryAssignments(
      [{ id: "t1", accountId: "a1", label: "INTERETS 2027" }],
      [
        { accountId: "a1", label: "INTERETS 2025", categoryId: "interest" },
        { accountId: "a1", label: "INTERETS 2026", categoryId: "interest" },
      ]
    );
    expect(result.get("t1")).toBe("interest");
  });
});

describe("normalizeLabelForCategorization", () => {
  it("strips an embedded calendar year", () => {
    expect(normalizeLabelForCategorization("INTERETS 2025")).toBe("interets");
    expect(normalizeLabelForCategorization("Interets 2026")).toBe("interets");
    expect(normalizeLabelForCategorization("INTERETS 2025")).toBe(normalizeLabelForCategorization("INTERETS 2026"));
  });

  it("does not strip a 4-digit run that's part of a longer alphanumeric token", () => {
    // A reference/invoice number shouldn't lose its digits just because a
    // substring of it happens to look like a year.
    expect(normalizeLabelForCategorization("VIR REF20251234X")).toBe("vir ref20251234x");
  });

  it("still trims and lowercases like normalizeLabel", () => {
    expect(normalizeLabelForCategorization("  Carrefour  ")).toBe("carrefour");
  });
});
