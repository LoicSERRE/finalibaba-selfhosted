import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OWNER_USER_ID } from "@/lib/domain/users";

// The owner user's id exists as a literal in three unrelated places, and there
// is no way to make it one: schema.prisma cannot reference TypeScript, and the
// seed scripts cannot import from lib/ because the production image ships
// prisma/ without it (that import is exactly what broke the v2.0.0 demo deploy
// with MODULE_NOT_FOUND, after the release was already published).
//
// So this pins them together. It is the cheap half of a fix whose expensive
// half would be restructuring the image layout for a dev-only script.

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf-8");

const SEEDS = ["prisma/seed.ts", "prisma/seed-demo.ts", "prisma/seed-multiuser.ts"];

describe("owner id stays consistent across the places it is spelled out", () => {
  it("matches every @default() in the Prisma schema", () => {
    const schema = read("prisma/schema.prisma");
    const defaults = [...schema.matchAll(/@default\("([^"]+)"\)/g)]
      .map((m) => m[1])
      .filter((v) => v.startsWith("user-"));

    expect(defaults.length).toBeGreaterThan(0);
    for (const value of new Set(defaults)) {
      expect(value).toBe(OWNER_USER_ID);
    }
  });

  it.each(SEEDS)("matches the constant declared in %s", (path) => {
    const src = read(path);
    const match = /const OWNER_USER_ID = "([^"]+)";/.exec(src);

    expect(match, `${path} should declare OWNER_USER_ID locally`).not.toBeNull();
    expect(match![1]).toBe(OWNER_USER_ID);
  });

  it.each(SEEDS)("%s does not import from lib/, which the image lacks", (path) => {
    // The runner stage copies prisma/ but not lib/ (see Dockerfile), so any
    // such import fails only at container runtime - after a release is cut.
    const code = read(path)
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");

    expect(code).not.toMatch(/from\s+["']\.\.\/lib\//);
    expect(code).not.toMatch(/from\s+["']@\/lib\//);
  });
});
