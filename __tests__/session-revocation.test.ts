import { describe, expect, it } from "vitest";
import { isSessionRevoked } from "@/lib/auth-context";

/**
 * "Sign out everywhere" is the only thing standing between a stolen phone and
 * a 30-day session, and before v2.10.6 the only alternative was deleting the
 * account, which cascades the whole portfolio. So both failure directions
 * matter equally: refusing a session that should live logs everybody out, and
 * honouring one that should not makes the button decorative.
 *
 * The comparison lived inside getViewer, reachable only by standing up a real
 * session, which is why it had never been tested on its own.
 */

const REVOKED_AT = new Date("2026-09-14T12:00:00Z");
const seconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

describe("a session issued before the revocation", () => {
  it("is refused", () => {
    expect(isSessionRevoked(REVOKED_AT, seconds("2026-09-14T11:59:59Z"))).toBe(true);
  });

  it("is refused even one millisecond before", () => {
    expect(isSessionRevoked(REVOKED_AT, seconds("2026-09-14T11:59:59.999Z"))).toBe(true);
  });

  it("is refused when it carries no issue stamp at all", () => {
    // Pre-v2.10.6 tokens. Treated as revoked rather than trusted: honouring an
    // unstampable token makes revocation a no-op for exactly the sessions it
    // was aimed at.
    expect(isSessionRevoked(REVOKED_AT, undefined)).toBe(true);
    expect(isSessionRevoked(REVOKED_AT, null)).toBe(true);
    expect(isSessionRevoked(REVOKED_AT, 0)).toBe(true);
  });
});

describe("a session issued after the revocation", () => {
  it("is honoured, or signing back in would be impossible", () => {
    expect(isSessionRevoked(REVOKED_AT, seconds("2026-09-14T12:00:01Z"))).toBe(false);
  });

  it("is honoured at the exact instant of revocation", () => {
    // The comparison is strictly-before, so a token minted on the same second
    // survives. Logging out and straight back in must work.
    expect(isSessionRevoked(REVOKED_AT, seconds("2026-09-14T12:00:00Z"))).toBe(false);
  });
});

describe("a user who never revoked anything", () => {
  it("is never refused, whatever the token says", () => {
    expect(isSessionRevoked(null, seconds("2020-01-01T00:00:00Z"))).toBe(false);
    expect(isSessionRevoked(undefined, undefined)).toBe(false);
  });
});

describe("the unit the stamp is read in", () => {
  it("treats issuedAt as JWT seconds, not milliseconds", () => {
    // Read as milliseconds, a real token lands in 1970 and every session on
    // the instance is refused. The failure is total and silent-looking: the
    // app simply signs everyone out and nothing says why.
    const issued = seconds("2026-09-14T12:00:01Z");
    expect(isSessionRevoked(REVOKED_AT, issued)).toBe(false);
    expect(new Date(issued).getFullYear()).toBe(1970);
  });
});
