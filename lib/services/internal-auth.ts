import type { NextRequest } from "next/server";
import { hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * The shared gate for every container-to-container route: the ones sync/
 * calls directly with no browser session, which are therefore excluded from
 * proxy.ts's NextAuth matcher and have to authenticate themselves
 * (`/api/alerts/check`, `/api/transactions/auto-categorize`,
 * `/api/investments/snapshot-balances`, `/api/realtime/notify`).
 *
 * The bearer is DERIVED from `NEXTAUTH_SECRET` (HKDF, mirrored byte for byte
 * by sync/internal_auth.py), so there is still no second secret to configure.
 * It used to be `NEXTAUTH_SECRET` verbatim: every one of these requests then
 * carried the session-signing key in a header, and anything that saw one - an
 * APP_SERVICE_URL pointed at the wrong host, a proxy logging headers - could
 * forge any session. The derived token opens these routes and nothing else.
 *
 * The same token goes the other way too (`internalAuthHeaders()` on every call
 * to the sync service), which had no authentication at all: any container on
 * the Docker network could start a bank sync or answer a pending 2FA step.
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
export function internalApiToken(): string | null {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return null;
  // Fixed salt and info, as in crypto-at-rest.ts: both languages must derive
  // the same value on every restart. Distinct from that key's inputs, so the
  // token and the encryption key share no bytes.
  return Buffer.from(
    hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.from("finalibaba-internal-api"), Buffer.from("bearer-v1"), 32)
  ).toString("base64url");
}

/** Headers for a call to the sync service; empty when no secret is set. */
export function internalAuthHeaders(): Record<string, string> {
  const token = internalApiToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function isInternalRequest(req: NextRequest): boolean {
  const expected = internalApiToken();
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
