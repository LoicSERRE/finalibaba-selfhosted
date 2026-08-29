import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

/**
 * The shared gate for every container-to-container route: the ones sync/
 * calls directly with no browser session, which are therefore excluded from
 * proxy.ts's NextAuth matcher and have to authenticate themselves
 * (`/api/alerts/check`, `/api/transactions/auto-categorize`,
 * `/api/investments/snapshot-balances`, `/api/realtime/notify`).
 *
 * `NEXTAUTH_SECRET` doubles as the bearer token rather than introducing a
 * second required secret: it is already mandatory and its leak is already
 * maximally severe (session forgery), so reusing it here does not widen the
 * blast radius. See CLAUDE.md's "Alerts & webhooks".
 *
 * Extracted because all four routes carried a byte-identical copy of this
 * function. Four copies of an auth check is a maintenance hazard on its own
 * terms: a change like the constant-time comparison below has to be found and
 * applied in every one of them, and missing one fails silently open-ish rather
 * than loudly.
 *
 * The comparison is timing-safe. The previous `===` leaked, in principle, how
 * many leading bytes of a guess were correct. That is a weak oracle against a
 * 256-bit secret over a network, and no attack on it is claimed here, but a
 * constant-time compare costs nothing and removes the question - the same
 * reasoning applied to the login timing oracle during the v2.0 security audit.
 */
export function isInternalRequest(req: NextRequest): boolean {
  const expected = process.env.NEXTAUTH_SECRET;
  if (!expected) return false;

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;

  const provided = auth.slice("Bearer ".length);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length; compare buffers of equal size and fold the length check into the
  // boolean result instead.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}
