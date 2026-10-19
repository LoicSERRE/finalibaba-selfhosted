import { describe, expect, it } from "vitest";
import {
  NOTE_MAX_LENGTH,
  TAGS_MAX,
  TAG_MAX_LENGTH,
  normalizeNote,
  normalizeTag,
  parseTags,
  validateNoteAndTags,
} from "@/lib/domain/transaction-notes";

/**
 * Notes and tags (v2.14). One definition of "a tag" shared by the action,
 * the ledger filter and the export: if these drifted, a tag saved as
 * "Vacances" would be filtered as "#vacances " and match nothing.
 */
describe("normalizeNote", () => {
  it("stores no empty note", () => {
    expect(normalizeNote("   ")).toBeNull();
    expect(normalizeNote(null)).toBeNull();
    expect(normalizeNote("  remboursé  ")).toBe("remboursé");
  });
});

describe("tags", () => {
  it("drop a leading #, trim and collapse inner whitespace", () => {
    expect(normalizeTag("  ##frais   pro ")).toBe("frais pro");
  });

  it("are deduplicated without regard to case, first spelling kept, order kept", () => {
    expect(parseTags("Vacances, travail, vacances, #VACANCES, ,  Été")).toEqual(["Vacances", "travail", "Été"]);
    expect(parseTags(["b", "a", "B"])).toEqual(["b", "a"]);
  });

  it("treat accented capitals as the same tag", () => {
    expect(parseTags(["Été", "été"])).toEqual(["Été"]);
  });
});

describe("validateNoteAndTags", () => {
  it("accepts what fits", () => {
    expect(validateNoteAndTags("x".repeat(NOTE_MAX_LENGTH), Array.from({ length: TAGS_MAX }, (_, i) => `t${i}`))).toBeNull();
  });

  it("names the first rule broken", () => {
    expect(validateNoteAndTags("x".repeat(NOTE_MAX_LENGTH + 1), [])).toBe("note_too_long");
    expect(validateNoteAndTags(null, Array.from({ length: TAGS_MAX + 1 }, (_, i) => `t${i}`))).toBe("too_many_tags");
    expect(validateNoteAndTags(null, ["x".repeat(TAG_MAX_LENGTH + 1)])).toBe("tag_too_long");
  });
});
