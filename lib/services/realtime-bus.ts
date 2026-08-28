/**
 * In-process pub/sub for the SSE "something changed, go re-fetch" signal - see
 * CLAUDE.md's "Trade Republic real-time tracking" for the full design. Deliberately
 * a plain in-memory `Set`, not Redis/an external broker: this app runs as a single
 * container/single process for a single user, so a subscriber list that only needs
 * to survive the lifetime of one process is the correct, minimal scope here - the
 * same accepted-scope precedent `sync/setup_tr.py`'s own in-memory `_pending` global
 * already sets for this codebase.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

// Coalesces bursts of near-simultaneous notify() calls (e.g. cash and portfolio
// both changing from the same underlying trade) into a single broadcast, so an
// open tab doesn't run router.refresh() several times in the same second.
const DEBOUNCE_MS = 2000;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notify(): void {
  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    for (const listener of listeners) listener();
  }, DEBOUNCE_MS);
}
