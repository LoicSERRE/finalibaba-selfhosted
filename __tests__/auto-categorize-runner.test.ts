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
  categoryFindManyMock,
  categoryCreateMock,
  detectPairsMock,
} = vi.hoisted(() => ({
  txFindManyMock: vi.fn(),
  txUpdateManyMock: vi.fn(),
  categoryFindManyMock: vi.fn(),
  categoryCreateMock: vi.fn(),
  detectPairsMock: vi.fn(() => new Set<string>()),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    transaction: { findMany: txFindManyMock, updateMany: txUpdateManyMock },
    category: { findMany: categoryFindManyMock, create: categoryCreateMock },
  },
}));

vi.mock("@/lib/domain/internal-transfers", () => ({
  detectInternalTransferPairs: detectPairsMock,
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
  categoryFindManyMock.mockReset().mockResolvedValue([]);
  categoryCreateMock.mockReset();
  detectPairsMock.mockReset().mockReturnValue(new Set());
});

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
  it("flags detected pairs and clears only this user's own \"Revenus\"", async () => {
    queueTransactionQueries([
      { id: "t1", accountId: "acc-1", amountCents: BigInt(-500), date: new Date() },
      { id: "t2", accountId: "acc-2", amountCents: BigInt(500), date: new Date() },
    ]);
    detectPairsMock.mockReturnValue(new Set(["t1", "t2"]));

    await autoCategorizeForUser("user-a", ACCOUNTS);

    const flagged = txUpdateManyMock.mock.calls.find(
      ([a]) => a.data?.isInternalTransfer === true
    );
    expect(flagged?.[0].where.id.in).toEqual(["t1", "t2"]);

    // The retroactive cleanup must not clear a category belonging to someone
    // else who happens to have named theirs "Revenus" too.
    const cleared = txUpdateManyMock.mock.calls.find(([a]) => a.data?.categoryId === null);
    expect(cleared?.[0].where.category).toEqual({ userId: "user-a", name: "Revenus" });
  });

  it("writes nothing when no pair is detected", async () => {
    queueTransactionQueries([
      { id: "t1", accountId: "acc-1", amountCents: BigInt(-500), date: new Date() },
    ]);
    detectPairsMock.mockReturnValue(new Set());

    await autoCategorizeForUser("user-a", ACCOUNTS);

    expect(txUpdateManyMock).not.toHaveBeenCalled();
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
