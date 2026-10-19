/**
 * A transaction's note and tags (v2.14): what the user may write, normalized
 * once here so the action, the ledger filter and the CSV export all agree on
 * what a tag is. Pure - no I/O.
 */

export const NOTE_MAX_LENGTH = 500;
export const TAGS_MAX = 10;
export const TAG_MAX_LENGTH = 32;

export type NoteError = "note_too_long" | "too_many_tags" | "tag_too_long";

/** Trimmed note, or null for an empty one (no "" rows to filter around). */
export function normalizeNote(raw: string | null | undefined): string | null {
  const note = (raw ?? "").trim();
  return note === "" ? null : note;
}

/** One tag as stored: trimmed, inner whitespace collapsed, a leading "#" dropped. */
export function normalizeTag(raw: string): string {
  // startsWith rather than a /^#+/ regex: a "#" in a regex literal makes
  // lizard drop the function that follows (dev-docs/release-audit.md, item 2).
  let tag = raw.trim();
  while (tag.startsWith("#")) tag = tag.slice(1);
  return tag.replaceAll(/\s+/g, " ").trim();
}

/**
 * Tags from a comma-separated field or a list, deduplicated without regard
 * to case (the first spelling wins: "Vacances" then "vacances" is one tag),
 * empties dropped, order kept.
 */
export function parseTags(raw: string | readonly string[]): string[] {
  const parts = typeof raw === "string" ? raw.split(",") : raw;
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of parts) {
    const tag = normalizeTag(part);
    const key = tag.toLocaleLowerCase("fr");
    if (tag === "" || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

/** The first rule a note/tags pair breaks, or null when it can be saved. */
export function validateNoteAndTags(note: string | null, tags: readonly string[]): NoteError | null {
  if (note !== null && note.length > NOTE_MAX_LENGTH) return "note_too_long";
  if (tags.length > TAGS_MAX) return "too_many_tags";
  if (tags.some((tag) => tag.length > TAG_MAX_LENGTH)) return "tag_too_long";
  return null;
}
