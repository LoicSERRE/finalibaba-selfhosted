/**
 * The command palette's static commands and how a query ranks them (v2.15).
 * Pure: labels arrive already translated, so this knows nothing of i18n.
 */

export type PaletteGroup = "pages" | "actions" | "accounts" | "categories" | "transactions" | "search";

export type PaletteItem = {
  id: string;
  group: PaletteGroup;
  label: string;
  /** Extra words that should find it ("budget" finds "Budgets", "réglages" finds Settings). */
  keywords?: readonly string[];
  /** Shown to the right: a shortcut ("g t") or a hint (account, date). */
  hint?: string;
  href?: string;
  /** Marks a figure the discretion mode must blur. */
  amount?: string;
};

/** Lowercase, accents and leading "#" stripped, whitespace collapsed. */
export function foldQuery(text: string): string {
  let folded = text.normalize("NFD").replaceAll(/\p{M}/gu, "").toLowerCase().trim();
  while (folded.startsWith("#")) folded = folded.slice(1);
  return folded.replaceAll(/\s+/g, " ");
}

/**
 * How well a query matches an item: 0 = not at all. Every query word must
 * appear in the label or a keyword; a label that starts with the query beats
 * one with a word starting with it, which beats a match anywhere.
 */
export function scoreItem(item: PaletteItem, query: string): number {
  const q = foldQuery(query);
  if (q === "") return 1;
  const label = foldQuery(item.label);
  const haystack = [label, ...(item.keywords ?? []).map(foldQuery)].join(" ");
  const words = q.split(" ");
  if (!words.every((word) => haystack.includes(word))) return 0;
  if (label.startsWith(q)) return 3;
  if (label.split(/[\s'-]+/).some((part) => part.startsWith(words[0]))) return 2;
  return 1;
}

/** Items that match, best first; ties keep their given order. */
export function rankItems(items: readonly PaletteItem[], query: string): PaletteItem[] {
  return items
    .map((item, index) => ({ item, index, score: scoreItem(item, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}

/**
 * The final list: commands whose name matches, then what the server found,
 * then commands found only through a keyword or mid-word, then the ledger
 * search. "net" should list NETFLIX before the dashboard it finds through
 * the keyword "net worth".
 */
export function composeResults(commands: readonly PaletteItem[], found: readonly PaletteItem[], query: string): PaletteItem[] {
  const ranked = rankItems(commands, query);
  const strong = ranked.filter((item) => scoreItem(item, query) >= 2 || foldQuery(query) === "");
  const weak = ranked.filter((item) => !strong.includes(item));
  const search = found.filter((item) => item.group === "search");
  const rest = found.filter((item) => item.group !== "search");
  return [...strong, ...rest, ...weak, ...search];
}

/** The shortest query worth a server round trip. */
export const PALETTE_SEARCH_MIN = 2;
export const PALETTE_SEARCH_MAX = 80;
