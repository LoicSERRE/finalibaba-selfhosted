import { describe, expect, it } from "vitest";
import { excludeInternalTransfers, excludeInternalTransfersOnSplit } from "@/lib/domain/transaction-filters";

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
