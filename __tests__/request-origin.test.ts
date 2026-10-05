/* eslint-disable sonarjs/no-clear-text-protocols -- fixtures, not requests:
   a LAN instance is legitimately reached over plain HTTP, which is exactly
   the default setup this check has to keep working for. */
import { describe, expect, it } from "vitest";
import { isAllowedOrigin } from "@/lib/domain/request-origin";

const base = { origin: null, host: null, forwardedHost: null, appUrl: undefined };

describe("isAllowedOrigin - APP_URL unset (host comparison)", () => {
  it("accepts the app's own page posting to itself on a LAN address", () => {
    expect(isAllowedOrigin({ ...base, origin: "http://192.168.1.20:3000", host: "192.168.1.20:3000" })).toBe(true);
  });

  it("refuses another site posting a form at the instance", () => {
    expect(isAllowedOrigin({ ...base, origin: "https://evil.example", host: "192.168.1.20:3000" })).toBe(false);
  });

  it("refuses a request with no Origin at all", () => {
    expect(isAllowedOrigin({ ...base, host: "192.168.1.20:3000" })).toBe(false);
  });

  it('refuses the opaque "null" origin (sandboxed iframe, file://)', () => {
    expect(isAllowedOrigin({ ...base, origin: "null", host: "192.168.1.20:3000" })).toBe(false);
  });

  it("refuses an unparseable Origin", () => {
    expect(isAllowedOrigin({ ...base, origin: "not a url", host: "192.168.1.20:3000" })).toBe(false);
  });

  it("compares against X-Forwarded-Host when a proxy set it", () => {
    expect(
      isAllowedOrigin({ ...base, origin: "https://money.example.com", host: "app:3000", forwardedHost: "money.example.com" })
    ).toBe(true);
  });

  it("does not let the port be ignored", () => {
    expect(isAllowedOrigin({ ...base, origin: "http://192.168.1.20:8080", host: "192.168.1.20:3000" })).toBe(false);
  });

  it("refuses when the request names no host to compare with", () => {
    expect(isAllowedOrigin({ ...base, origin: "http://192.168.1.20:3000" })).toBe(false);
  });
});

describe("isAllowedOrigin - APP_URL set (strict)", () => {
  const appUrl = "https://money.example.com";

  it("accepts exactly the configured origin", () => {
    expect(isAllowedOrigin({ ...base, origin: "https://money.example.com", host: "app:3000", appUrl })).toBe(true);
  });

  it("ignores the Host header entirely, so a matching Host cannot vouch for a foreign origin", () => {
    // The DNS-rebinding shape: the attacker's hostname, with a Host to match.
    expect(isAllowedOrigin({ ...base, origin: "http://rebind.example", host: "rebind.example", appUrl })).toBe(false);
  });

  it("refuses a scheme downgrade of the configured origin", () => {
    expect(isAllowedOrigin({ ...base, origin: "http://money.example.com", host: "money.example.com", appUrl })).toBe(false);
  });

  it("tolerates a trailing path or slash in APP_URL", () => {
    expect(
      isAllowedOrigin({ ...base, origin: "https://money.example.com", host: "x", appUrl: "https://money.example.com/" })
    ).toBe(true);
  });

  it("falls back to host comparison when APP_URL is blank or invalid", () => {
    expect(isAllowedOrigin({ ...base, origin: "http://h:3000", host: "h:3000", appUrl: "   " })).toBe(true);
    expect(isAllowedOrigin({ ...base, origin: "http://h:3000", host: "h:3000", appUrl: "nope" })).toBe(true);
  });
});
