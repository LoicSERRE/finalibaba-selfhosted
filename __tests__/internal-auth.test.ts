import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { internalApiToken, internalAuthHeaders, isInternalRequest } from "@/lib/services/internal-auth";

// The gate on every container-to-container route. Those routes are excluded
// from proxy.ts's NextAuth matcher, so this function is the only thing between
// the public internet and a full alert run or a whole-instance categorization
// pass. It used to exist as four byte-identical copies; these tests pin the
// behaviour now that there is one.

const reqWith = (headers: Record<string, string>) =>
  ({ headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } }) as unknown as NextRequest;

const SECRET = "s".repeat(43);
// HKDF of SECRET. sync/tests/test_internal_auth.py pins the same string: the
// two containers must agree on it or every internal call is refused.
const TOKEN = "loE5GJCCqu2DXj9JVJCxDnqDVuu7_FnzwoJ210JJbL4";

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.NEXTAUTH_SECRET;
});

describe("isInternalRequest", () => {
  it("accepts the derived token as a bearer token", () => {
    expect(isInternalRequest(reqWith({ authorization: `Bearer ${TOKEN}` }))).toBe(true);
  });

  it("refuses NEXTAUTH_SECRET itself, so the session key never has to travel", () => {
    // The old scheme. Accepting it would keep a reason for some caller to put
    // the session-signing key in a header again.
    expect(isInternalRequest(reqWith({ authorization: `Bearer ${SECRET}` }))).toBe(false);
  });

  it.each([
    ["no header at all", {}],
    ["empty bearer", { authorization: "Bearer " }],
    ["wrong token, same length", { authorization: `Bearer ${"x".repeat(TOKEN.length)}` }],
    ["right token, wrong scheme", { authorization: `Basic ${TOKEN}` }],
    ["no scheme", { authorization: TOKEN }],
    ["a prefix of the token", { authorization: `Bearer ${TOKEN.slice(0, 20)}` }],
    ["the token plus trailing data", { authorization: `Bearer ${TOKEN}x` }],
    // "bearer " lowercase: startsWith is case-sensitive, and every caller in
    // this repo sends the canonical casing.
    ["lowercase scheme", { authorization: `bearer ${TOKEN}` }],
  ])("rejects %s", (_label, headers) => {
    expect(isInternalRequest(reqWith(headers))).toBe(false);
  });

  it("rejects everything when NEXTAUTH_SECRET is unset", () => {
    // Fails closed: an instance with no secret configured must not become a
    // wide-open internal API, it must accept nothing.
    delete process.env.NEXTAUTH_SECRET;
    expect(isInternalRequest(reqWith({ authorization: `Bearer ${TOKEN}` }))).toBe(false);
    expect(isInternalRequest(reqWith({ authorization: "Bearer " }))).toBe(false);
  });

  it("does not throw on a length mismatch", () => {
    // timingSafeEqual throws when the two buffers differ in length, which is
    // exactly the common case here; the implementation has to handle it rather
    // than let a 500 escape from an auth check.
    expect(() => isInternalRequest(reqWith({ authorization: "Bearer short" }))).not.toThrow();
    expect(() =>
      isInternalRequest(reqWith({ authorization: `Bearer ${"y".repeat(500)}` }))
    ).not.toThrow();
  });
});

describe("the token sent to the sync service", () => {
  it("is the one isInternalRequest accepts, never the secret", () => {
    expect(internalApiToken()).toBe(TOKEN);
    expect(internalAuthHeaders()).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });

  it("changes with NEXTAUTH_SECRET", () => {
    process.env.NEXTAUTH_SECRET = "t".repeat(43);
    expect(internalApiToken()).not.toBe(TOKEN);
  });

  it("sends no header at all rather than an empty bearer when unset", () => {
    delete process.env.NEXTAUTH_SECRET;
    expect(internalApiToken()).toBeNull();
    expect(internalAuthHeaders()).toEqual({});
  });
});
