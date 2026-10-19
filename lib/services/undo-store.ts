import { randomUUID } from "node:crypto";

/**
 * Short-lived "undo" tickets for deletions (v2.13).
 *
 * A deleting action snapshots what it is about to remove, keeps it here under
 * a random token bound to the user, and hands only the token to the browser.
 * Undoing presents the token back; the snapshot itself never leaves the
 * server, so a caller cannot smuggle in fields, ids or another user's rows.
 *
 * In memory on purpose: the window is a minute, the app is one process per
 * install, and losing a pending undo on a restart costs nothing that the
 * confirmation dialog it replaces did not already cost. Cached on globalThis
 * so dev-mode module reloads keep pending tickets.
 */

export const UNDO_WINDOW_MS = 60_000;

type Entry = { userId: string; value: unknown; expiresAt: number };

const holder = globalThis as unknown as { __finalibabaUndo?: Map<string, Entry> };
const store: Map<string, Entry> = (holder.__finalibabaUndo ??= new Map());

function sweep(now: number) {
  for (const [token, entry] of store) {
    if (entry.expiresAt <= now) store.delete(token);
  }
}

// No type parameter and no `= Date.now()` default here: either one makes
// lizard drop the function from its report (dev-docs/release-audit.md,
// item 2), and callers cast what takeUndo returns anyway.
export function rememberUndo(userId: string, value: unknown, now?: number): string {
  const at = now ?? Date.now();
  sweep(at);
  const token = randomUUID();
  store.set(token, { userId, value, expiresAt: at + UNDO_WINDOW_MS });
  return token;
}

/**
 * The snapshot behind a token, at most once. Another user's token answers
 * exactly like an unknown or expired one (and stays usable by its owner), so
 * a guessed token learns nothing.
 */
export function takeUndo(userId: string, token: string, now?: number): unknown {
  const entry = store.get(token);
  if (!entry || entry.userId !== userId) return null;
  store.delete(token);
  return entry.expiresAt > (now ?? Date.now()) ? entry.value : null;
}

/** Test seam: forget every pending ticket. */
export function clearUndoStore() {
  store.clear();
}
