import { describe, expect, it } from "vitest";
import {
  excludeFromBudgetTotals,
  excludeFromBudgetTotalsOnSplit,
  excludeInternalTransfers,
  excludeInternalTransfersOnSplit,
} from "@/lib/domain/transaction-filters";

describe("excludeInternalTransfers", () => {
  it("adds isInternalTransfer: false alongside the given where clause", () => {
    expect(excludeInternalTransfers({ amountCents: { lt: 0 } })).toEqual({
      amountCents: { lt: 0 },
      isInternalTransfer: false,
    });
  });

  it("works with an empty where clause", () => {
    expect(excludeInternalTransfers({})).toEqual({ isInternalTransfer: false });
  });
});

describe("excludeInternalTransfersOnSplit", () => {
  it("nests isInternalTransfer: false under the transaction relation", () => {
    expect(excludeInternalTransfersOnSplit({ amountCents: { lt: 0 } })).toEqual({
      amountCents: { lt: 0 },
      transaction: { isInternalTransfer: false },
    });
  });

  it("merges a transactionWhere clause underneath, not replacing it", () => {
    const result = excludeInternalTransfersOnSplit({ amountCents: { lt: 0 } }, { date: { gte: "2026-01-01" } });
    expect(result).toEqual({
      amountCents: { lt: 0 },
      transaction: { date: { gte: "2026-01-01" }, isInternalTransfer: false },
    });
  });
});

describe("excludeFromBudgetTotals", () => {
  it("excludes securities movements as well as internal transfers", () => {
    // A broker's cash account is a CHECKING account, so buying shares was
    // counted as spending and selling them as income.
    expect(excludeFromBudgetTotals({ amountCents: { lt: 0 } })).toEqual({
      amountCents: { lt: 0 },
      isInternalTransfer: false,
      isSecuritiesMovement: false,
    });
  });
});

describe("excludeFromBudgetTotalsOnSplit", () => {
  it("nests both flags under the transaction relation", () => {
    expect(excludeFromBudgetTotalsOnSplit({ amountCents: { lt: 0 } })).toEqual({
      amountCents: { lt: 0 },
      transaction: { isInternalTransfer: false, isSecuritiesMovement: false },
    });
  });

  it("merges a transactionWhere clause underneath, not replacing it", () => {
    // The date filter a category total needs lives on the parent transaction,
    // so it has to survive being wrapped.
    expect(
      excludeFromBudgetTotalsOnSplit({ amountCents: { lt: 0 } }, { date: { gte: "2026-01-01" } })
    ).toEqual({
      amountCents: { lt: 0 },
      transaction: { date: { gte: "2026-01-01" }, isInternalTransfer: false, isSecuritiesMovement: false },
    });
  });
});
