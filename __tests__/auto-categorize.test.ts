import { describe, expect, it } from "vitest";
import { suggestCategoryAssignments } from "@/lib/domain/auto-categorize";

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
});
