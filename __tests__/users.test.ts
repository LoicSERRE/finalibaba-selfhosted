import { describe, expect, it } from "vitest";
import {
  OWNER_USER_ID,
  normalizeUsername,
  validateCredentials,
  MIN_USERNAME_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@/lib/domain/users";

// Pure helpers only, same lib/domain boundary as every other test here - the
// Server Actions in lib/actions/users.ts (bootstrap, invitations) are DB
// orchestration and stay out of scope, per this project's stated
// lib/actions/* coverage exclusion.

describe("OWNER_USER_ID", () => {
  it("matches the id hardcoded in the v2 migration and in the Account/SyncLog DB defaults", () => {
    // If this ever changes, prisma/migrations/20260828160000_multi_user_foundation
    // and both @default("user-owner") column defaults must change with it, or
    // the Python sync sidecar starts writing rows pointing at a user that
    // doesn't exist.
    expect(OWNER_USER_ID).toBe("user-owner");
  });
});

describe("normalizeUsername", () => {
  it("lowercases and trims so one person can't end up with two lookalike accounts", () => {
    expect(normalizeUsername("  Loic  ")).toBe("loic");
    expect(normalizeUsername("LOIC")).toBe("loic");
  });

  it("leaves an already-normalized name untouched", () => {
    expect(normalizeUsername("loic")).toBe("loic");
  });
});

describe("validateCredentials", () => {
  it("accepts a username and password that both clear the minimums", () => {
    expect(validateCredentials("loic", "correct-horse-battery")).toEqual({ ok: true });
  });

  it("rejects a username shorter than the minimum, after normalization", () => {
    expect(validateCredentials("ab", "correct-horse-battery")).toEqual({
      ok: false,
      error: "username_too_short",
    });
    // Whitespace doesn't count toward the length - it's trimmed first.
    expect(validateCredentials(`${" ".repeat(10)}ab `, "correct-horse-battery")).toEqual({
      ok: false,
      error: "username_too_short",
    });
  });

  it("rejects a password shorter than the minimum", () => {
    expect(validateCredentials("loic", "short")).toEqual({ ok: false, error: "password_too_short" });
  });

  it("reports the username problem first when both are too short", () => {
    expect(validateCredentials("a", "b")).toEqual({ ok: false, error: "username_too_short" });
  });

  it("accepts exactly the minimum lengths (boundary)", () => {
    const username = "a".repeat(MIN_USERNAME_LENGTH);
    const password = "a".repeat(MIN_PASSWORD_LENGTH);
    expect(validateCredentials(username, password)).toEqual({ ok: true });
  });
});
