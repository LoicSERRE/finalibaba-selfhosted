import { beforeEach, describe, expect, it } from "vitest";
import { moveCompanyCategories } from "@/lib/services/company-handover";

// lib/services/company-handover.ts against an in-memory stand-in: what
// matters is where every row points afterwards.

type Category = { id: string; userId: string; name: string; color: string; kind: string; budgetCents: number | null };
type Row = { id: string; accountId: string; categoryId: string | null };
type Split = { id: string; transactionId: string; categoryId: string | null };

let categories: Category[];
let transactions: Row[];
let splits: Split[];
let recurring: Row[];
let seq = 0;

type OnAccounts = { accountId: { in: string[] } };
const onAccounts = (w: OnAccounts, accountId: string) => w.accountId.in.includes(accountId);
const txOf = (id: string) => transactions.find((t) => t.id === id)!;

const tx = {
  category: {
    findMany: async ({ where }: { where: { userId: string; OR: [{ transactions: { some: OnAccounts } }, unknown, unknown] } }) => {
      const scope = where.OR[0].transactions.some;
      return categories.filter(
        (c) =>
          c.userId === where.userId &&
          (transactions.some((t) => t.categoryId === c.id && onAccounts(scope, t.accountId)) ||
            splits.some((s) => s.categoryId === c.id && onAccounts(scope, txOf(s.transactionId).accountId)) ||
            recurring.some((r) => r.categoryId === c.id && onAccounts(scope, r.accountId))),
      );
    },
    upsert: async ({ where, create }: { where: { userId_name: { userId: string; name: string } }; create: Omit<Category, "id" | "budgetCents"> }) => {
      const found = categories.find((c) => c.userId === where.userId_name.userId && c.name === where.userId_name.name);
      if (found) return found;
      const made = { id: `new-${++seq}`, budgetCents: null, ...create };
      categories.push(made);
      return made;
    },
  },
  transaction: {
    updateMany: async ({ where, data }: { where: OnAccounts & { categoryId: string }; data: { categoryId: string } }) => {
      for (const t of transactions) if (t.categoryId === where.categoryId && onAccounts(where, t.accountId)) t.categoryId = data.categoryId;
    },
  },
  transactionSplit: {
    updateMany: async ({ where, data }: { where: { transaction: OnAccounts; categoryId: string }; data: { categoryId: string } }) => {
      for (const s of splits) {
        if (s.categoryId === where.categoryId && onAccounts(where.transaction, txOf(s.transactionId).accountId)) s.categoryId = data.categoryId;
      }
    },
  },
  recurringTransaction: {
    updateMany: async ({ where, data }: { where: OnAccounts & { categoryId: string }; data: { categoryId: string } }) => {
      for (const r of recurring) if (r.categoryId === where.categoryId && onAccounts(where, r.accountId)) r.categoryId = data.categoryId;
    },
  },
} as unknown as Parameters<typeof moveCompanyCategories>[0];

beforeEach(() => {
  seq = 0;
  categories = [
    { id: "old-loyers", userId: "camille", name: "Loyers", color: "#22c55e", kind: "INCOME", budgetCents: null },
    { id: "old-travaux", userId: "camille", name: "Travaux", color: "#f59e0b", kind: "EXPENSE", budgetCents: 50000 },
    { id: "old-courses", userId: "camille", name: "Courses", color: "#6366f1", kind: "EXPENSE", budgetCents: 40000 },
    { id: "marie-travaux", userId: "marie", name: "Travaux", color: "#000000", kind: "EXPENSE", budgetCents: 10000 },
  ];
  transactions = [
    { id: "t1", accountId: "sci-bank", categoryId: "old-loyers" },
    { id: "t2", accountId: "sci-bank", categoryId: "old-travaux" },
    { id: "t3", accountId: "sci-bank", categoryId: null },
    { id: "t4", accountId: "camille-perso", categoryId: "old-courses" },
    { id: "t5", accountId: "camille-perso", categoryId: "old-travaux" },
  ];
  splits = [{ id: "s1", transactionId: "t3", categoryId: "old-travaux" }];
  recurring = [{ id: "r1", accountId: "sci-bank", categoryId: "old-loyers" }];
});

describe("moveCompanyCategories", () => {
  it("re-points the company's rows to the new manager's category of the same name", async () => {
    await expect(moveCompanyCategories(tx, ["sci-bank"], "camille", "marie")).resolves.toBe(2);
    expect(transactions.find((t) => t.id === "t2")!.categoryId).toBe("marie-travaux");
    expect(splits[0].categoryId).toBe("marie-travaux");
  });

  it("creates what the new manager does not have, with its colour and kind but no budget", async () => {
    await moveCompanyCategories(tx, ["sci-bank"], "camille", "marie");
    const loyers = categories.find((c) => c.userId === "marie" && c.name === "Loyers")!;
    expect(loyers).toMatchObject({ color: "#22c55e", kind: "INCOME", budgetCents: null });
    expect(transactions.find((t) => t.id === "t1")!.categoryId).toBe(loyers.id);
    expect(recurring[0].categoryId).toBe(loyers.id);
  });

  it("leaves the previous manager's own accounts and categories alone", async () => {
    await moveCompanyCategories(tx, ["sci-bank"], "camille", "marie");
    expect(transactions.find((t) => t.id === "t4")!.categoryId).toBe("old-courses");
    expect(transactions.find((t) => t.id === "t5")!.categoryId).toBe("old-travaux");
    expect(categories.filter((c) => c.userId === "camille")).toHaveLength(3);
    // A category the company never used is not copied.
    expect(categories.some((c) => c.userId === "marie" && c.name === "Courses")).toBe(false);
  });

  it("does nothing for a company with no accounts", async () => {
    await expect(moveCompanyCategories(tx, [], "camille", "marie")).resolves.toBe(0);
  });
});
