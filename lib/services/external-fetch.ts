/**
 * `fetch` against a third-party API, with a deadline.
 *
 * Every outbound call in `lib/services/` used to be a bare `fetch` with a
 * `next.revalidate` window and no timeout. Next's fetch has no default one, so
 * a provider that *hangs* - not one that is down, which fails fast and cleanly
 * - would block the awaiting render for as long as the socket stayed open.
 * `/analytics` is a Server Component that awaits several of these in sequence
 * (benchmarks, sector weights, FX), so the page would simply never finish.
 *
 * This is not a new lesson in this codebase. `lib/actions/sync.ts` already
 * learned it from a real production report - a sync button spinning forever
 * because nothing bounded the call - and fixed it with exactly this shape. It
 * was never applied to the market-data calls, which are the ones a user is
 * actually waiting on while looking at a page.
 *
 * A helper rather than a `signal:` line repeated at each call site, following
 * the same reasoning as lib/domain/transaction-filters.ts's
 * `excludeInternalTransfers`: it does not make the omission impossible, it
 * makes the correct thing the easiest thing to reach for, and puts the
 * decision in one place instead of nine.
 *
 * Callers keep their own try/catch and their own empty-result fallbacks - a
 * timeout arrives as a rejection like any other network failure, so nothing
 * downstream needed to change. Degrading to "this figure is unavailable" is
 * already how every one of them handles an unreachable provider.
 */

/** Long enough for a slow-but-working provider, short enough that a hung one
 *  cannot hold a page render. Market data is a nice-to-have on every screen
 *  that requests it: none of it is worth more than a few seconds of blank. */
export const EXTERNAL_FETCH_TIMEOUT_MS = 8000;

export function fetchExternal(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS) });
}
