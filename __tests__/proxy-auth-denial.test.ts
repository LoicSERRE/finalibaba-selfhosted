import { describe, expect, it } from "vitest";
import { isAuthDenial } from "@/proxy";

/**
 * The gate that let everybody in.
 *
 * v2.10.6 moved the auth decision through a wrapper so the CSP nonce could be
 * threaded onto permitted requests, and asked `authResult instanceof
 * NextResponse` to tell a refusal from a permission. next-auth bundles its own
 * copy of `next/server`, so the NextResponse it builds is a different class
 * object: `instanceof` answered false for a real 307 to /login, the code fell
 * through to `NextResponse.next()`, and the refusal became an authorisation.
 *
 * With `getViewer()` falling back to the instance owner whenever there is no
 * session - which is exactly the case for an anonymous request - every
 * authenticated page rendered the owner's accounts, balances and the
 * admin-only Settings surface to anybody who asked. Reported from a real
 * instance.
 *
 * The first test below is the one that matters: it builds a refusal whose
 * class is NOT this module's NextResponse, which is the whole bug. A test
 * using the real NextResponse would have passed against the broken code.
 */

/** A response from "another copy of next/server" - a different class entirely. */
class ForeignResponse {
  constructor(
    readonly status: number,
    private readonly map: Record<string, string> = {}
  ) {}
  readonly headers = { get: (k: string) => this.map[k.toLowerCase()] ?? null };
}

describe("a refusal is recognised whoever built it", () => {
  it("a 307 to the sign-in page from a foreign class", () => {
    const redirect = new ForeignResponse(307, { location: "https://x/login?callbackUrl=%2Fsettings" });
    expect(isAuthDenial(redirect)).toBe(true);
  });

  it("a 401 on an API route, which withAuth answers instead of redirecting", () => {
    expect(isAuthDenial(new ForeignResponse(401))).toBe(true);
  });

  it("a 403", () => {
    expect(isAuthDenial(new ForeignResponse(403))).toBe(true);
  });

  it("a 200 that still carries a location, which is a redirect either way", () => {
    expect(isAuthDenial(new ForeignResponse(200, { location: "/login" }))).toBe(true);
  });
});

describe("a permission is not mistaken for a refusal", () => {
  it("nothing at all, which is what withAuth returns when it lets you through", () => {
    expect(isAuthDenial(undefined)).toBe(false);
    expect(isAuthDenial(null)).toBe(false);
  });

  it("a bare 200 with no location - withAuth's own next()", () => {
    // This one must stay false or every permitted request would be returned
    // without the nonce headers, and a nonce-less page renders blank rather
    // than merely less safely.
    expect(isAuthDenial(new ForeignResponse(200))).toBe(false);
  });

  it("something with no status at all", () => {
    expect(isAuthDenial({})).toBe(false);
    expect(isAuthDenial({ status: "307" })).toBe(false);
    expect(isAuthDenial("redirect")).toBe(false);
  });
});

describe("the identity check this replaced", () => {
  it("would have called the foreign redirect a permission", () => {
    // Pinning the bug itself, so nobody reinstates the shorter-looking check.
    // `instanceof` is not merely unreliable here, it is reliably WRONG: the
    // object is a real redirect and belongs to another copy of the module.
    class LocalNextResponse {}
    const redirect = new ForeignResponse(307, { location: "/login" });
    expect(redirect).not.toBeInstanceOf(LocalNextResponse);
    expect(isAuthDenial(redirect)).toBe(true);
  });
});
