import { parseCents } from "@/lib/utils/format";

/**
 * A cap table while it is typed: the associates and the démembrement blocks,
 * as strings, keyed so a block can name its two sides before they have ids.
 * toCapTableInput turns it into what the Server Actions take - and they check
 * every invariant again (lib/domain/company.ts).
 */

export type CapTableRowDraft = {
  key: string;
  id?: string;
  name: string;
  /** Parts in full ownership; blocks below hold the dismembered ones. */
  parts: string;
  username: string;
  /** The person editing: linked to themselves, no username to type. */
  self: boolean;
  /** Their current account, as typed in the base currency ("12500,50"). */
  currentAccount: string;
  /** "YYYY-MM-DD" or "" - required of an usufructuary. */
  birthDate: string;
};

export type DismembermentDraft = {
  key: string;
  parts: string;
  usufructuaryKey: string;
  bareOwnerKey: string;
};

let nextKey = 0;
export function newRowKey(): string {
  nextKey += 1;
  return `row-${nextKey}`;
}

export function emptyRow(self = false): CapTableRowDraft {
  return { key: newRowKey(), name: "", parts: "", username: "", self, currentAccount: "", birthDate: "" };
}

/** Every part the draft gives out: full ownership and blocks, for the live total. */
export function draftParts(rows: CapTableRowDraft[], blocks: DismembermentDraft[]): number[] {
  return [...rows.map((r) => Number(r.parts || 0)), ...blocks.map((b) => Number(b.parts || 0))];
}

export function toCapTableInput(rows: CapTableRowDraft[], blocks: DismembermentDraft[] = []) {
  const index = new Map(rows.map((r, i) => [r.key, i]));
  return {
    associates: rows.map((r) => ({
      ...(r.id ? { id: r.id } : {}),
      name: r.name.trim(),
      parts: Number(r.parts || 0),
      username: r.self ? null : r.username.trim() || null,
      self: r.self,
      // Negative or malformed stays as typed: the server refuses it with a
      // message, rather than this quietly turning it into 0.
      currentAccountCents: r.currentAccount.trim() ? Number(parseCents(r.currentAccount)) : 0,
      birthDate: r.birthDate || null,
    })),
    // A side that no longer exists becomes -1, which the server refuses.
    dismemberments: blocks.map((b) => ({
      parts: Number(b.parts || 0),
      usufructuary: index.get(b.usufructuaryKey) ?? -1,
      bareOwner: index.get(b.bareOwnerKey) ?? -1,
    })),
  };
}
