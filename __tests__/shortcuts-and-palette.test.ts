import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Keyboard shortcuts and the command palette's ranking (v2.15), plus its
 * server search with Prisma mocked. The properties a user relies on: a
 * shortcut letter typed into a field stays a letter, "g t" only counts when
 * the keys come together, the palette finds things however they are typed,
 * and its search never reaches outside what the viewer may see.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const m = vi.hoisted(() => ({
  account: vi.fn(async () => [{ id: "a1", name: "Livret A", institution: { name: "LCL" } }]),
  category: vi.fn(async () => [{ id: "c1", name: "Loisirs" }]),
  transaction: vi.fn(async () => [{ id: "t1", label: "NETFLIX", date: new Date("2026-10-01T12:00:00Z"), amountCents: BigInt(-1599), accountId: "a1", account: { name: "Courant" } }]),
  viewContext: vi.fn(async () => ({ ownerId: "owner-1", accountIds: ["a1", "a2"] })),
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: { account: { findMany: m.account }, category: { findMany: m.category }, transaction: { findMany: m.transaction } },
}));
vi.mock("@/lib/auth-context", () => ({ getViewContext: m.viewContext }));

import { GO_WINDOW_MS, goTarget, isBareKey, isPaletteShortcut, isTypingTarget } from "@/lib/domain/shortcuts";
import { composeResults, foldQuery, rankItems, scoreItem, type PaletteItem } from "@/lib/domain/command-palette";
import { searchPalette } from "@/lib/actions/palette";

/** First argument of a mock's first call, whatever the mock's declared arity. */
const firstArg = (fn: { mock: { calls: unknown[] } }) => (fn.mock.calls[0] as unknown[])[0];

const key = (over: Record<string, unknown> = {}) => ({ key: "g", ctrlKey: false, metaKey: false, altKey: false, repeat: false, target: { tagName: "BODY" }, ...over });

beforeEach(() => vi.clearAllMocks());

describe("shortcuts", () => {
  it("never fire while typing in a field", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) expect(isTypingTarget({ tagName })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isBareKey(key({ target: { tagName: "INPUT" } }))).toBe(false);
  });

  it("leave modified and repeated keys to the browser", () => {
    expect(isBareKey(key())).toBe(true);
    for (const over of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { repeat: true }]) expect(isBareKey(key(over))).toBe(false);
  });

  it("open the palette on Ctrl+K and Cmd+K, even from a field", () => {
    expect(isPaletteShortcut(key({ key: "k", ctrlKey: true }))).toBe(true);
    expect(isPaletteShortcut(key({ key: "K", metaKey: true, target: { tagName: "INPUT" } }))).toBe(true);
    expect(isPaletteShortcut(key({ key: "k" }))).toBe(false);
    expect(isPaletteShortcut(key({ key: "k", ctrlKey: true, altKey: true }))).toBe(false);
  });

  it("go to a page on g then a letter, only in time", () => {
    expect(goTarget({ key: "g", at: 1000 }, "t", 1500)).toBe("/transactions");
    expect(goTarget({ key: "g", at: 1000 }, "D", 1500)).toBe("/");
    expect(goTarget({ key: "g", at: 1000 }, "t", 1000 + GO_WINDOW_MS + 1)).toBeNull();
    expect(goTarget({ key: "x", at: 1000 }, "t", 1100)).toBeNull();
    expect(goTarget({ key: "g", at: 1000 }, "z", 1100)).toBeNull();
    expect(goTarget(null, "t", 1100)).toBeNull();
  });
});

describe("palette ranking", () => {
  const items: PaletteItem[] = [
    { id: "1", group: "pages", label: "Analytique" },
    { id: "2", group: "pages", label: "Rapport fiscal", keywords: ["impôts", "plus-values"] },
    { id: "3", group: "pages", label: "Paramètres · Sécurité" },
    { id: "4", group: "pages", label: "Budgets" },
  ];

  it("folds accents, case, spaces and a leading #", () => {
    expect(foldQuery("  ÉTÉ   #x ")).toBe("ete #x");
    expect(foldQuery("#Vacances")).toBe("vacances");
  });

  it("finds by keyword, without accents, every word required", () => {
    expect(rankItems(items, "impots").map((i) => i.id)).toEqual(["2"]);
    expect(rankItems(items, "parametres securite").map((i) => i.id)).toEqual(["3"]);
    expect(rankItems(items, "parametres budget")).toEqual([]);
  });

  it("ranks a label prefix above a word start above a match anywhere", () => {
    expect(scoreItem(items[3], "bud")).toBe(3);
    expect(scoreItem(items[1], "fisc")).toBe(2);
    expect(scoreItem(items[0], "lytique")).toBe(1);
    expect(scoreItem(items[0], "zzz")).toBe(0);
  });

  it("lists name matches, then search results, then keyword-only matches, then the ledger search", () => {
    const commands: PaletteItem[] = [
      { id: "dash", group: "pages", label: "Tableau de bord", keywords: ["net worth"] },
      { id: "netpage", group: "pages", label: "Network" },
    ];
    const found: PaletteItem[] = [
      { id: "tx", group: "transactions", label: "NETFLIX" },
      { id: "search", group: "search", label: "Rechercher" },
    ];
    expect(composeResults(commands, found, "net").map((i) => i.id)).toEqual(["netpage", "tx", "dash", "search"]);
  });

  it("keeps the given order for an empty query", () => {
    expect(rankItems(items, "").map((i) => i.id)).toEqual(["1", "2", "3", "4"]);
  });
});

describe("searchPalette", () => {
  it("does not query for too short or too long input", async () => {
    for (const q of ["", " a ", "x".repeat(81), 42 as unknown as string]) {
      expect(await searchPalette(q)).toEqual({ accounts: [], categories: [], transactions: [] });
    }
    expect(m.viewContext).not.toHaveBeenCalled();
  });

  it("stays inside the view context and formats what it returns", async () => {
    const found = await searchPalette("  net ");
    expect(firstArg(m.account)).toMatchObject({ where: { id: { in: ["a1", "a2"] } }, take: 5 });
    expect(firstArg(m.category)).toMatchObject({ where: { userId: "owner-1" } });
    const txWhere = (firstArg(m.transaction) as { where: Record<string, unknown> }).where;
    expect(txWhere).toMatchObject({ accountId: { in: ["a1", "a2"] }, isInternalTransfer: false });
    expect(txWhere.OR).toContainEqual({ tags: { has: "net" } });
    expect(found.transactions[0]).toMatchObject({ id: "t1", date: "2026-10-01", accountId: "a1", account: "Courant" });
    expect(found.transactions[0].amount).toMatch(/15,99/);
    expect(found.accounts[0]).toEqual({ id: "a1", name: "Livret A", institution: "LCL" });
  });

  it("skips the tag clause for a query that normalizes to nothing", async () => {
    await searchPalette("##");
    const txWhere = (firstArg(m.transaction) as { where: { OR: unknown[] } }).where;
    expect(txWhere.OR).toHaveLength(2);
  });
});
