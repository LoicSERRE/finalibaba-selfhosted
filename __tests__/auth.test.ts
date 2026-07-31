import { describe, expect, it } from "vitest";
import { createRateLimiter, getClientIp } from "@/lib/auth";

describe("getClientIp", () => {
  it("reads the first hop of x-forwarded-for", () => {
    expect(getClientIp({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" })).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    expect(getClientIp({ "x-real-ip": "203.0.113.9" })).toBe("203.0.113.9");
  });

  it("prefers x-forwarded-for over x-real-ip when both are present", () => {
    expect(getClientIp({ "x-forwarded-for": "203.0.113.5", "x-real-ip": "203.0.113.9" })).toBe(
      "203.0.113.5"
    );
  });

  it("falls back to a shared 'unknown' bucket when no proxy header is present", () => {
    expect(getClientIp(undefined)).toBe("unknown");
    expect(getClientIp({})).toBe("unknown");
  });

  it("ignores blank header values", () => {
    expect(getClientIp({ "x-forwarded-for": "   ", "x-real-ip": "203.0.113.9" })).toBe(
      "203.0.113.9"
    );
  });
});

describe("createRateLimiter", () => {
  it("allows up to maxAttempts requests for the same key", () => {
    const checkRateLimit = createRateLimiter(5, 15 * 60 * 1000);
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("1.2.3.4")).toBe(true);
    }
  });

  it("blocks the request once maxAttempts is exceeded", () => {
    const checkRateLimit = createRateLimiter(5, 15 * 60 * 1000);
    for (let i = 0; i < 5; i++) checkRateLimit("1.2.3.4");
    expect(checkRateLimit("1.2.3.4")).toBe(false);
  });

  it("tracks each key independently - this is the exact bug that was fixed: a constant key would let one attacker's lockout affect every other visitor", () => {
    const checkRateLimit = createRateLimiter(5, 15 * 60 * 1000);
    for (let i = 0; i < 5; i++) checkRateLimit("attacker-ip");
    expect(checkRateLimit("attacker-ip")).toBe(false);
    // a different key must be unaffected by the first key's lockout
    expect(checkRateLimit("real-owner-ip")).toBe(true);
  });

  it("resets the count after the window elapses", () => {
    const checkRateLimit = createRateLimiter(2, 10);
    expect(checkRateLimit("1.2.3.4")).toBe(true);
    expect(checkRateLimit("1.2.3.4")).toBe(true);
    expect(checkRateLimit("1.2.3.4")).toBe(false);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(checkRateLimit("1.2.3.4")).toBe(true);
        resolve();
      }, 20);
    });
  });
});
