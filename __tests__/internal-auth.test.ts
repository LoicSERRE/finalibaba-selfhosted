import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { isInternalRequest } from "@/lib/services/internal-auth";

// The gate on every container-to-container route. Those routes are excluded
// from proxy.ts's NextAuth matcher, so this function is the only thing between
// the public internet and a full alert run or a whole-instance categorization
// pass. It used to exist as four byte-identical copies; these tests pin the
// behaviour now that there is one.

const reqWith = (headers: Record<string, string>) =>
  ({ headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } }) as unknown as NextRequest;

const SECRET = "s".repeat(43);

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.NEXTAUTH_SECRET;
});

describe("isInternalRequest", () => {
  it("accepts the exact secret as a bearer token", () => {
    expect(isInternalRequest(reqWith({ authorization: `Bearer ${SECRET}` }))).toBe(true);
  });

  it.each([
    ["no header at all", {}],
    ["empty bearer", { authorization: "Bearer " }],
    ["wrong secret, same length", { authorization: `Bearer ${"x".repeat(43)}` }],
    ["right secret, wrong scheme", { authorization: `Basic ${SECRET}` }],
    ["no scheme", { authorization: SECRET }],
    ["a prefix of the secret", { authorization: `Bearer ${SECRET.slice(0, 20)}` }],
    ["the secret plus trailing data", { authorization: `Bearer ${SECRET}x` }],
    // "bearer " lowercase: startsWith is case-sensitive, and every caller in
    // this repo sends the canonical casing.
    ["lowercase scheme", { authorization: `bearer ${SECRET}` }],
  ])("rejects %s", (_label, headers) => {
    expect(isInternalRequest(reqWith(headers))).toBe(false);
  });

  it("rejects everything when NEXTAUTH_SECRET is unset", () => {
    // Fails closed: an instance with no secret configured must not become a
    // wide-open internal API, it must accept nothing.
    delete process.env.NEXTAUTH_SECRET;
    expect(isInternalRequest(reqWith({ authorization: `Bearer ${SECRET}` }))).toBe(false);
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
