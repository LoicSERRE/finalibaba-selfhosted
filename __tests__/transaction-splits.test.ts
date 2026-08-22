import { describe, expect, it } from "vitest";
import { validateSplitLines } from "@/lib/domain/transaction-splits";

describe("validateSplitLines", () => {
  it("accepts lines that sum exactly to the transaction total", () => {
    const result = validateSplitLines(
      [
        { categoryId: "cat1", amountCents: BigInt(-3000) },
        { categoryId: "cat2", amountCents: BigInt(-2000) },
      ],
      BigInt(-5000),
    );
    expect(result).toEqual({ valid: true });
  });

  it("rejects a single line - a split needs at least 2 categories", () => {
    const result = validateSplitLines([{ categoryId: "cat1", amountCents: BigInt(-5000) }], BigInt(-5000));
    expect(result).toEqual({ valid: false, error: "too_few_lines" });
  });

  it("rejects zero lines", () => {
    expect(validateSplitLines([], BigInt(-5000))).toEqual({ valid: false, error: "too_few_lines" });
  });

  it("rejects lines that don't sum to the total", () => {
    const result = validateSplitLines(
      [
        { categoryId: "cat1", amountCents: BigInt(-3000) },
        { categoryId: "cat2", amountCents: BigInt(-1500) },
      ],
      BigInt(-5000),
    );
    expect(result).toEqual({ valid: false, error: "does_not_sum_to_total" });
  });

  it("rejects a zero-cent line even when the rest sums correctly with a 3rd line", () => {
    const result = validateSplitLines(
      [
        { categoryId: "cat1", amountCents: BigInt(-5000) },
        { categoryId: "cat2", amountCents: BigInt(0) },
      ],
      BigInt(-5000),
    );
    expect(result).toEqual({ valid: false, error: "zero_amount_line" });
  });

  it("allows a null categoryId on a split line (uncategorized portion)", () => {
    const result = validateSplitLines(
      [
        { categoryId: "cat1", amountCents: BigInt(-3000) },
        { categoryId: null, amountCents: BigInt(-2000) },
      ],
      BigInt(-5000),
    );
    expect(result).toEqual({ valid: true });
  });

  it("works for a positive (credit) transaction the same way", () => {
    const result = validateSplitLines(
      [
        { categoryId: "cat1", amountCents: BigInt(3000) },
        { categoryId: "cat2", amountCents: BigInt(2000) },
      ],
      BigInt(5000),
    );
    expect(result).toEqual({ valid: true });
  });
});
