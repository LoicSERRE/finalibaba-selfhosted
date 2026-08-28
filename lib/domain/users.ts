/**
 * User-identity constants and pure helpers (v2.0 multi-user).
 *
 * Deliberately its own module with zero imports: both lib/auth.ts and
 * lib/auth-context.ts need OWNER_USER_ID, and auth-context already imports
 * authOptions from auth.ts - putting the constant in either of those two
 * would create a circular import between them.
 */

/**
 * The fixed id of the instance owner, created by
 * prisma/migrations/20260828160000_multi_user_foundation.
 *
 * Also hardcoded as the DB-level DEFAULT on Account.userId and SyncLog.userId,
 * which is what lets sync/db.py keep INSERTing those tables with raw SQL that
 * knows nothing about ownership (see CLAUDE.md's "Multi-user architecture").
 * Changing this string requires a migration that rewrites both defaults and
 * every row referencing it.
 */
export const OWNER_USER_ID = "user-owner";

/**
 * Usernames are the login identifier, so they're normalized on the way in:
 * trimmed and lowercased. Without this, "Loic" and "loic" would be two
 * different accounts that look identical in the users list, and a user could
 * fail to log in over a capital letter they don't remember typing.
 */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Minimum viable credentials for the bootstrap/invitation screens. */
export const MIN_USERNAME_LENGTH = 3;
export const MIN_PASSWORD_LENGTH = 8;

export function validateCredentials(
  username: string,
  password: string
): { ok: true } | { ok: false; error: "username_too_short" | "password_too_short" } {
  if (normalizeUsername(username).length < MIN_USERNAME_LENGTH) {
    return { ok: false, error: "username_too_short" };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: "password_too_short" };
  }
  return { ok: true };
}
