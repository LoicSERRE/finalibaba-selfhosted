/**
 * In-process pub/sub for the SSE "something changed, go re-fetch" signal - see
 * CLAUDE.md's "Trade Republic real-time tracking" for the full design. Deliberately
 * a plain in-memory map, not Redis/an external broker: this app runs as a single
 * container/single process, so a subscriber list that only needs to survive the
 * lifetime of one process is the correct, minimal scope here - the same
 * accepted-scope precedent `sync/setup_tr.py`'s own in-memory `_pending` global
 * already sets for this codebase.
 *
 * Keyed by userId as of v2.0. Before that it was one flat Set, which in
 * multi-user would have meant any user's sync refreshing every other user's open
 * tabs - harmless data-wise (the refresh re-fetches through each tab's own
 * session, so nobody sees anyone else's numbers) but a real privacy signal: a
 * tab visibly refreshing tells you someone else's bank just moved.
 */

type Listener = () => void;

const listenersByUser = new Map<string, Set<Listener>>();

// Coalesces bursts of near-simultaneous notify() calls (e.g. cash and portfolio
// both changing from the same underlying trade) into a single broadcast, so an
// open tab doesn't run router.refresh() several times in the same second.
// Per user, so one user's burst can't swallow another's signal.
const DEBOUNCE_MS = 2000;
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function subscribe(userId: string, listener: Listener): () => void {
  const set = listenersByUser.get(userId) ?? new Set<Listener>();
  set.add(listener);
  listenersByUser.set(userId, set);
  return () => {
    set.delete(listener);
    // Drop the bucket once its last tab disconnects, so a long-lived process
    // doesn't accumulate an empty Set per user who ever visited.
    if (set.size === 0) listenersByUser.delete(userId);
  };
}

export function notify(userId: string): void {
  if (debounceTimers.has(userId)) return;
  debounceTimers.set(
    userId,
    setTimeout(() => {
      debounceTimers.delete(userId);
      for (const listener of listenersByUser.get(userId) ?? []) listener();
    }, DEBOUNCE_MS)
  );
}
