import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The categorization engine, extracted out of lib/actions/ in v2.0 precisely
// so it could take a userId without becoming a browser-invocable
// impersonation primitive. That move also took it out of the wholesale
// lib/actions/* coverage exclusion, and it sat at 0%.
//
// What these pin is the part a bug would corrupt silently: which transactions
// enter the pool, and whose categories they are matched against. Both are
// per-user now, and getting either wrong files one person's spending under
// another's budget.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const {
  txFindManyMock,
  txUpdateManyMock,
  txUpdateMock,
  transactionMock,
  categoryFindManyMock,
  categoryCreateMock,
  detectPairingsMock,
} = vi.hoisted(() => ({
  txFindManyMock: vi.fn(),
  txUpdateManyMock: vi.fn(),
  txUpdateMock: vi.fn(),
  transactionMock: vi.fn(),
  categoryFindManyMock: vi.fn(),
  categoryCreateMock: vi.fn(),
  detectPairingsMock: vi.fn(() => [] as Array<{ creditId: string; debitId: string }>),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    transaction: { findMany: txFindManyMock, updateMany: txUpdateManyMock, update: txUpdateMock },
    category: { findMany: categoryFindManyMock, create: categoryCreateMock },
    $transaction: transactionMock,
  },
}));

vi.mock("@/lib/domain/internal-transfers", () => ({
  detectInternalTransferPairings: detectPairingsMock,
}));

import { autoCategorizeForUser } from "@/lib/services/auto-categorize-runner";

/** The engine issues its queries in a fixed order; queue the answers. */
function queueTransactionQueries(...results: unknown[][]) {
  txFindManyMock.mockReset();
  for (const r of results) txFindManyMock.mockResolvedValueOnce(r);
  txFindManyMock.mockResolvedValue([]);
}

const ACCOUNTS = ["acc-1", "acc-2"];

beforeEach(() => {
  txFindManyMock.mockReset().mockResolvedValue([]);
  txUpdateManyMock.mockReset().mockResolvedValue({ count: 0 });
  txUpdateMock.mockReset().mockImplementation(async (args) => args);
  transactionMock.mockReset().mockImplementation(async (ops) => ops);
  categoryFindManyMock.mockReset().mockResolvedValue([]);
  categoryCreateMock.mockReset();
  detectPairingsMock.mockReset().mockReturnValue([]);
});

/** The per-row writes the transfer pass batches into one $transaction. */
function pairWrites() {
  return txUpdateMock.mock.calls.map(([a]) => a);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("account scoping", () => {
  it("does nothing at all for a user with no accounts", async () => {
    await expect(autoCategorizeForUser("user-a", [])).resolves.toEqual({ categorized: 0 });
    // Not even the internal-transfer pass runs: an unscoped query here would
    // pull in every user's transactions.
    expect(txFindManyMock).not.toHaveBeenCalled();
    expect(txUpdateManyMock).not.toHaveBeenCalled();
  });

  it("scopes every query to the given accounts, never the whole table", async () => {
    await autoCategorizeForUser("user-a", ACCOUNTS);

    expect(txFindManyMock.mock.calls.length).toBeGreaterThan(0);
    for (const [arg] of txFindManyMock.mock.calls) {
      expect(JSON.stringify(arg.where)).toContain("acc-1");
    }
  });

  it("narrows to a single account when asked, and only if the user owns it", async () => {
    await autoCategorizeForUser("user-a", ACCOUNTS, "acc-2");
    const pool = txFindManyMock.mock.calls.at(1)?.[0];
    expect(JSON.stringify(pool.where)).toContain("acc-2");

    // An account id outside the user's own set must not widen back out to
    // "everything I own"; it resolves to a set that matches nothing.
    txFindManyMock.mockClear();
    await autoCategorizeForUser("user-a", ACCOUNTS, "someone-elses-account");
    const forged = txFindManyMock.mock.calls.at(1)?.[0];
    expect(JSON.stringify(forged.where)).not.toContain("someone-elses-account");
    expect(JSON.stringify(forged.where)).toContain("__none__");
  });
});

describe("internal-transfer pass", () => {
  /** Two unflagged legs of one transfer, nobody has ruled on either. */
  const FRESH_PAIR = [
    { id: "t1", accountId: "acc-1", amountCents: BigInt(-500), date: new Date(), isInternalTransfer: false, internalTransferPairId: null },
    { id: "t2", accountId: "acc-2", amountCents: BigInt(500), date: new Date(), isInternalTransfer: false, internalTransferPairId: null },
  ];

  it("flags detected pairs and clears only this user's own \"Revenus\"", async () => {
    queueTransactionQueries(FRESH_PAIR);
    detectPairingsMock.mockReturnValue([{ creditId: "t2", debitId: "t1" }]);

    await autoCategorizeForUser("user-a", ACCOUNTS);

    // Each leg records the other, so a later pass can tell what justified it.
    expect(pairWrites()).toEqual([
      { where: { id: "t1" }, data: { isInternalTransfer: true, internalTransferPairId: "t2" } },
      { where: { id: "t2" }, data: { isInternalTransfer: true, internalTransferPairId: "t1" } },
    ]);

    // The retroactive cleanup must not clear a category belonging to someone
    // else who happens to have named theirs "Revenus" too.
    const cleared = txUpdateManyMock.mock.calls.find(([a]) => a.data?.categoryId === null);
    expect(cleared?.[0].where.category).toEqual({ userId: "user-a", name: "Revenus" });
    expect(cleared?.[0].where.id.in).toEqual(["t1", "t2"]);
  });

  it("never considers a row a person has ruled on, in either direction", async () => {
    // The whole point of the third state: the pool is what nobody decided.
    await autoCategorizeForUser("user-a", ACCOUNTS);

    const pool = txFindManyMock.mock.calls[0][0];
    expect(pool.where.internalTransferManual).toBeNull();
  });

  it("keeps out the two kinds of row that can never be half of a transfer", async () => {
    // A share purchase has no second bank account recording the other side,
    // and a card payment is not a movement between your own accounts - both
    // only ever competed with the real counterpart, and on real data both won
    // a tie against one.
    await autoCategorizeForUser("user-a", ACCOUNTS);

    const pool = txFindManyMock.mock.calls[0][0];
    expect(pool.where.isSecuritiesMovement).toBe(false);
    expect(pool.where.NOT).toEqual({ sourceEventType: { startsWith: "CARD_" } });
  });

  it("writes nothing when no pair is detected", async () => {
    queueTransactionQueries([
      { id: "t1", accountId: "acc-1", amountCents: BigInt(-500), date: new Date(), isInternalTransfer: false, internalTransferPairId: null },
    ]);

    await autoCategorizeForUser("user-a", ACCOUNTS);

    expect(transactionMock).not.toHaveBeenCalled();
    expect(txUpdateManyMock).not.toHaveBeenCalled();
  });

  it("leaves an already-correct pairing completely alone", async () => {
    queueTransactionQueries([
      { id: "t1", accountId: "acc-1", amountCents: BigInt(-500), date: new Date(), isInternalTransfer: true, internalTransferPairId: "t2" },
      { id: "t2", accountId: "acc-2", amountCents: BigInt(500), date: new Date(), isInternalTransfer: true, internalTransferPairId: "t1" },
    ]);
    detectPairingsMock.mockReturnValue([{ creditId: "t2", debitId: "t1" }]);

    await autoCategorizeForUser("user-a", ACCOUNTS);

    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("re-pairs a leg onto the counterpart that turned up later", async () => {
    // t1 was matched with the unrelated t3 when it was the only same-amount
    // credit around; t2 has since arrived on the same day and wins. Nothing
    // used to revisit this - both wrong halves stayed out of every total.
    queueTransactionQueries([
      { id: "t1", accountId: "acc-1", amountCents: BigInt(-500), date: new Date(), isInternalTransfer: true, internalTransferPairId: "t3" },
      { id: "t2", accountId: "acc-2", amountCents: BigInt(500), date: new Date(), isInternalTransfer: false, internalTransferPairId: null },
      { id: "t3", accountId: "acc-2", amountCents: BigInt(500), date: new Date(), isInternalTransfer: true, internalTransferPairId: "t1" },
    ]);
    detectPairingsMock.mockReturnValue([{ creditId: "t2", debitId: "t1" }]);

    await autoCategorizeForUser("user-a", ACCOUNTS);

    expect(pairWrites()).toEqual([
      { where: { id: "t1" }, data: { isInternalTransfer: true, internalTransferPairId: "t2" } },
      { where: { id: "t2" }, data: { isInternalTransfer: true, internalTransferPairId: "t1" } },
    ]);
    // t3 loses its flag: the pairing that justified it is gone and this pass
    // can see that for itself, because t1 is in the very pool it re-derived.
    const revoked = txUpdateManyMock.mock.calls.find(([a]) => a.data?.isInternalTransfer === false);
    expect(revoked?.[0].where.id.in).toEqual(["t3"]);
  });

  it("never revokes a flag whose other leg it cannot see", async () => {
    // The co-owned-account case: this user sees one leg of a transfer another
    // stakeholder's pass matched. Revoking here and re-flagging there would
    // flip the row between them forever.
    queueTransactionQueries([
      { id: "t1", accountId: "acc-1", amountCents: BigInt(-500), date: new Date(), isInternalTransfer: true, internalTransferPairId: "elsewhere" },
    ]);

    await autoCategorizeForUser("user-a", ACCOUNTS);

    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("never revokes a flag that predates the recorded pairing", async () => {
    // Flagged before the column existed and left unpaired by the migration's
    // backfill: no evidence either way, so it keeps its flag until a person
    // says otherwise rather than being dropped on nothing.
    queueTransactionQueries([
      { id: "t1", accountId: "acc-1", amountCents: BigInt(-500), date: new Date(), isInternalTransfer: true, internalTransferPairId: null },
    ]);

    await autoCategorizeForUser("user-a", ACCOUNTS);

    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("categorization sources", () => {
  it("returns early when nothing is uncategorized", async () => {
    queueTransactionQueries([], []); // transfer candidates, then the pool
    await expect(autoCategorizeForUser("user-a", ACCOUNTS)).resolves.toEqual({ categorized: 0 });
    expect(txUpdateManyMock).not.toHaveBeenCalled();
  });

  it("matches a known merchant and creates the default category under this user", async () => {
    queueTransactionQueries(
      [], // no transfer candidates
      [{ id: "t1", accountId: "acc-1", label: "CARREFOUR MARKET", merchantCategoryCode: null }],
      [] // no categorized history to learn from
    );
    categoryFindManyMock.mockResolvedValue([]);
    categoryCreateMock.mockImplementation(async ({ data }) => ({ id: "cat-new", name: data.name }));

    const result = await autoCategorizeForUser("user-a", ACCOUNTS);

    expect(result.categorized).toBe(1);
    // The lookup and the create are both scoped: Category.name is unique per
    // user now, so an unscoped name lookup would resolve to whichever user's
    // "Alimentation" was found first.
    expect(categoryFindManyMock.mock.calls[0][0].where).toMatchObject({ userId: "user-a" });
    expect(categoryCreateMock.mock.calls[0][0].data).toMatchObject({ userId: "user-a" });
    expect(txUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { categoryId: "cat-new" } })
    );
  });

  it("reuses an existing category instead of creating a duplicate", async () => {
    queueTransactionQueries(
      [],
      [{ id: "t1", accountId: "acc-1", label: "CARREFOUR MARKET", merchantCategoryCode: null }],
      []
    );
    categoryFindManyMock.mockResolvedValue([{ id: "cat-existing", name: "Alimentation" }]);

    const result = await autoCategorizeForUser("user-a", ACCOUNTS);

    expect(result.categorized).toBe(1);
    expect(categoryCreateMock).not.toHaveBeenCalled();
    expect(txUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { categoryId: "cat-existing" } })
    );
  });

  it("leaves a transaction alone when no source has an opinion", async () => {
    queueTransactionQueries(
      [],
      [{ id: "t1", accountId: "acc-1", label: "ZZZ UNKNOWN PAYEE", merchantCategoryCode: null }],
      []
    );

    await expect(autoCategorizeForUser("user-a", ACCOUNTS)).resolves.toEqual({ categorized: 0 });
    expect(txUpdateManyMock).not.toHaveBeenCalled();
  });

  it("prefers this user's own confirmed history over the merchant dictionary", async () => {
    // Two prior manual categorizations of the same label beat what the
    // dictionary would say for "CARREFOUR": self-learning reflects real intent.
    queueTransactionQueries(
      [],
      [{ id: "t1", accountId: "acc-1", label: "CARREFOUR MARKET", merchantCategoryCode: null }],
      [
        { accountId: "acc-1", label: "CARREFOUR MARKET", categoryId: "cat-learned" },
        { accountId: "acc-1", label: "CARREFOUR MARKET", categoryId: "cat-learned" },
      ]
    );

    const result = await autoCategorizeForUser("user-a", ACCOUNTS);

    expect(result.categorized).toBe(1);
    expect(categoryCreateMock).not.toHaveBeenCalled();
    expect(txUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { categoryId: "cat-learned" } })
    );
  });

  it("groups its writes by target category rather than one per transaction", async () => {
    queueTransactionQueries(
      [],
      [
        { id: "t1", accountId: "acc-1", label: "CARREFOUR MARKET", merchantCategoryCode: null },
        { id: "t2", accountId: "acc-1", label: "CARREFOUR CITY", merchantCategoryCode: null },
      ],
      []
    );
    categoryFindManyMock.mockResolvedValue([{ id: "cat-food", name: "Alimentation" }]);

    const result = await autoCategorizeForUser("user-a", ACCOUNTS);

    expect(result.categorized).toBe(2);
    expect(txUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(txUpdateManyMock.mock.calls[0][0].where.id.in.sort()).toEqual(["t1", "t2"]);
  });
});
