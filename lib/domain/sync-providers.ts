/**
 * What a user can pick in the bank search, across every sync backend.
 *
 * Woob's catalogue (~96 banks, fetched live) is one backend; Trade Republic is
 * another, and pytr talks to it directly rather than through Woob, which has
 * no module for it. That is an implementation detail nobody adding their bank
 * should have to know: they look for their bank in the list, and the app
 * decides which backend can reach it.
 *
 * The first cut exposed the backend instead - a standalone "Configure Trade
 * Republic" button on every institution row. It appeared next to institutions
 * that were not Trade Republic and could not become it, and it made adding an
 * account a two-step "create something generic, then attach TR to it" flow
 * rather than "pick your bank".
 */
export type BankPickerEntry = { module: string; label: string };

/**
 * Sentinel `module` value for Trade Republic. Not a Woob module name, and
 * deliberately shaped like the picker's existing `__other__` sentinel so it
 * cannot collide with one: Woob module names are lowercase identifiers such
 * as `lcl` or `boursorama`, never underscore-wrapped.
 */
export const TRADE_REPUBLIC_MODULE = "__trade_republic__";

/** Institution name for a Trade Republic connection, and its picker label. */
export const TRADE_REPUBLIC_LABEL = "Trade Republic";

export function isTradeRepublicModule(module: string | null | undefined): boolean {
  return module === TRADE_REPUBLIC_MODULE;
}

/**
 * The Woob catalogue plus Trade Republic, in one alphabetical list.
 *
 * Any Woob entry that happens to carry the same label is dropped rather than
 * shown twice. Woob has no Trade Republic module today (confirmed against its
 * live repository index, see CLAUDE.md), so this is a guard against a future
 * catalogue change rather than something that fires now - and it resolves the
 * ambiguity in the safer direction, since the native path is the one that
 * actually works.
 */
export function bankPickerEntries(woobModules: readonly BankPickerEntry[]): BankPickerEntry[] {
  const entries = woobModules.filter(
    (m) => m.label.trim().toLowerCase() !== TRADE_REPUBLIC_LABEL.toLowerCase(),
  );
  entries.push({ module: TRADE_REPUBLIC_MODULE, label: TRADE_REPUBLIC_LABEL });
  return entries.sort((a, b) => a.label.localeCompare(b.label, "fr", { sensitivity: "base" }));
}
