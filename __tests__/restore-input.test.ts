import { describe, expect, it } from "vitest";
import { restrictedRestoreInput } from "@/lib/domain/restore-input";

// What psql reads in an in-app restore: restricted mode first, so the file's
// backslash commands (\! runs a shell) are refused. That psql really refuses
// them under \restrict was checked against psql 16.15 when this was written.
const KEY = "0123456789abcdef0123456789abcdef";
const run = (sql: string) => restrictedRestoreInput(Buffer.from(sql, "latin1"), KEY).toString("latin1");

describe("restrictedRestoreInput", () => {
  it("starts with our own restrict line, before anything of the file's", () => {
    expect(run("\\! id\nSELECT 1;\n").startsWith(`\\restrict ${KEY}\n\\! id\n`)).toBe(true);
  });

  it("drops pg_dump's own restrict pair, which our mode would refuse", () => {
    const dump = "\\restrict AbC123xyz\n\nSET x = 1;\nCOPY t FROM stdin;\na\\tb\n\\.\n\\unrestrict AbC123xyz\n";
    expect(run(dump)).toBe(`\\restrict ${KEY}\n\nSET x = 1;\nCOPY t FROM stdin;\na\\tb\n\\.\n`);
  });

  it("leaves every other byte alone, whatever the encoding", () => {
    const bytes = Buffer.from([0x53, 0xc3, 0xa9, 0x0a, 0xff, 0x00, 0x5c, 0x21, 0x0a]);
    const out = restrictedRestoreInput(bytes, KEY);
    expect(out.subarray(out.length - bytes.length)).toEqual(bytes);
  });

  it("drops only whole restrict lines, never one hidden in a statement", () => {
    expect(run("SELECT '\\restrict x';\n")).toContain("SELECT '\\restrict x';\n");
    expect(run("  \\restrict AbC\n")).toContain("  \\restrict AbC\n");
  });

  it("refuses a key the file could guess or break out of", () => {
    expect(() => restrictedRestoreInput(Buffer.from(""), "short")).toThrow();
    expect(() => restrictedRestoreInput(Buffer.from(""), "0123456789abcdef\n\\! id")).toThrow();
  });
});
