import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  generateCspNonce,
} from "@/lib/domain/content-security-policy";

/**
 * A CSP is the one security control whose failure is completely silent: drop a
 * directive and the header is still a valid header, the app still renders, and
 * nothing anywhere reports that the policy got weaker. Every test here asserts
 * a directive is PRESENT with the value that makes it do work, because the
 * failure being guarded against is absence, not a wrong string.
 *
 * The same shape as the lizard blind spot and the `NOT (NULL LIKE ...)` filter
 * this version spent its time on: a measurement that stops measuring reads
 * exactly like a clean result.
 */

function directives(csp: string): Map<string, string> {
  return new Map(
    csp.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values.join(" ")];
    })
  );
}

describe("what the nonce buys", () => {
  it("removes 'unsafe-inline' from script-src rather than adding to it", () => {
    // The whole point: a browser that sees a nonce IGNORES 'unsafe-inline' in
    // the same directive. Emitting both would look stricter while changing
    // nothing for a CSP2 browser and weakening nothing for a CSP3 one.
    const scriptSrc = directives(buildContentSecurityPolicy("abc123")).get("script-src")!;
    expect(scriptSrc).toContain("'nonce-abc123'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("falls back to 'unsafe-inline' with no nonce, rather than blocking every script", () => {
    // proxy.ts cannot always supply one. Serving a policy that inerts Next's
    // own hydration payload would take the whole app down, which is a worse
    // outcome than the pre-v2.10.6 behaviour.
    const scriptSrc = directives(buildContentSecurityPolicy()).get("script-src")!;
    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("nonce-");
  });

  it("never emits 'strict-dynamic', which would void the Google host entries", () => {
    // Those hosts are what let a bank's reCAPTCHA load; 'strict-dynamic' makes
    // supporting browsers ignore the whole allowlist.
    expect(buildContentSecurityPolicy("n")).not.toContain("strict-dynamic");
  });
});

describe("the directives that must never quietly disappear", () => {
  const csp = directives(buildContentSecurityPolicy("n"));

  it("refuses to be framed, and refuses to frame anything but Google", () => {
    expect(csp.get("frame-ancestors")).toBe("'none'");
    expect(csp.get("frame-src")).toBe("'self' https://www.google.com");
  });

  it("keeps every same-origin-only directive same-origin", () => {
    expect(csp.get("default-src")).toBe("'self'");
    expect(csp.get("connect-src")).toBe("'self'");
    expect(csp.get("worker-src")).toBe("'self'");
    expect(csp.get("base-uri")).toBe("'self'");
    expect(csp.get("form-action")).toBe("'self'");
    expect(csp.get("object-src")).toBe("'none'");
  });

  it("allows the favicon host the redirect actually serves from", () => {
    // google.com/s2/favicons redirects to *.gstatic.com - found with a real
    // browser, not by reading the URL, and lost the moment someone tidies the
    // list down to the host the app requests.
    expect(csp.get("img-src")).toContain("https://*.gstatic.com");
  });

  it("allows no host anywhere beyond 'self', data:, and the two Google ones", () => {
    // Catches a new third-party host arriving in any directive at all, which
    // is how an allowlist stops being one.
    const hosts = buildContentSecurityPolicy("n").match(/https?:\/\/[^\s;]+/g) ?? [];
    expect([...new Set(hosts)].sort()).toEqual([
      "https://*.gstatic.com",
      "https://www.google.com",
      "https://www.gstatic.com",
    ]);
  });
});

describe("the nonce itself", () => {
  it("is unpredictable, which is the entire security property", () => {
    const nonces = new Set(Array.from({ length: 200 }, generateCspNonce));
    expect(nonces.size).toBe(200);
  });

  it("carries 128 bits and is usable inside a CSP unquoted-token position", () => {
    const nonce = generateCspNonce();
    expect(Buffer.from(nonce, "base64")).toHaveLength(16);
    // A ';' or a space would end the directive early and silently truncate the
    // policy; base64's own alphabet plus '=' is all that may appear.
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });
});
