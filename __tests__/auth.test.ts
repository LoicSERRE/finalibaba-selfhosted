import { afterEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import type { CredentialsConfig } from "next-auth/providers/credentials";
import { authOptions, createRateLimiter, getClientIp } from "@/lib/auth";

// authOptions.providers[0] is the single CredentialsProvider() config - see
// lib/auth.ts. Its top-level `.authorize` is next-auth v4's own hardcoded
// stub (`() => null`, see node_modules/next-auth/providers/credentials.js) -
// the real, user-supplied authorize() only lives at `.options.authorize`.
// NextAuth's real request pipeline merges `.options` back onto the provider
// at init time before ever calling `.authorize`, which is why this quirk is
// invisible outside a test that calls the provider directly like this one
// does. Verified empirically - calling `.authorize` directly silently
// returns null for every input, which looked like a real auth bug at first.
const provider = (authOptions.providers[0] as unknown as { options: CredentialsConfig })
  .options;

// checkRateLimit is a module-level singleton (created once at import time,
// not per-test) - every test below must use its own unique IP so it doesn't
// silently get rate-limited by an earlier test's attempts in this same file.
let ipCounter = 0;
function nextIp(): string {
  ipCounter++;
  return `10.0.0.${ipCounter}`;
}

function reqWithIp(ip: string) {
  return { headers: { "x-forwarded-for": ip } };
}

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

describe("authOptions credentials provider - authorize()", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when no password is provided", async () => {
    vi.stubEnv("AUTH_PASSWORD", "correct-horse");
    const result = await provider.authorize(
      { password: "" },
      reqWithIp(nextIp())
    );
    expect(result).toBeNull();
  });

  it("returns null when AUTH_PASSWORD is set and the password doesn't match", async () => {
    vi.stubEnv("AUTH_PASSWORD", "correct-horse");
    const result = await provider.authorize(
      { password: "wrong-password" },
      reqWithIp(nextIp())
    );
    expect(result).toBeNull();
  });

  it("returns the owner user when the password matches AUTH_PASSWORD (plaintext path)", async () => {
    vi.stubEnv("AUTH_PASSWORD", "correct-horse");
    const result = await provider.authorize(
      { password: "correct-horse" },
      reqWithIp(nextIp())
    );
    expect(result).toEqual({ id: "owner", name: "owner" });
  });

  it("uses AUTH_USER_NAME as the display name when set", async () => {
    vi.stubEnv("AUTH_PASSWORD", "correct-horse");
    vi.stubEnv("AUTH_USER_NAME", "Loïc");
    const result = await provider.authorize(
      { password: "correct-horse" },
      reqWithIp(nextIp())
    );
    expect(result).toEqual({ id: "owner", name: "Loïc" });
  });

  it("prefers AUTH_PASSWORD_HASH over AUTH_PASSWORD when both are set (bcrypt path)", async () => {
    const hash = await bcrypt.hash("correct-horse", 4);
    vi.stubEnv("AUTH_PASSWORD_HASH", hash);
    vi.stubEnv("AUTH_PASSWORD", "this-plaintext-must-be-ignored");
    const result = await provider.authorize(
      { password: "correct-horse" },
      reqWithIp(nextIp())
    );
    expect(result).toEqual({ id: "owner", name: "owner" });
  });

  it("returns null when the password doesn't match AUTH_PASSWORD_HASH", async () => {
    const hash = await bcrypt.hash("correct-horse", 4);
    vi.stubEnv("AUTH_PASSWORD_HASH", hash);
    const result = await provider.authorize(
      { password: "wrong-password" },
      reqWithIp(nextIp())
    );
    expect(result).toBeNull();
  });

  it("returns null once the per-IP rate limit is exhausted, even with the correct password", async () => {
    vi.stubEnv("AUTH_PASSWORD", "correct-horse");
    const ip = nextIp();
    // authOptions' real CredentialsProvider is built with the module-level
    // rate limiter (5 attempts/15min, see checkRateLimit in lib/auth.ts) -
    // exhaust it with wrong passwords first, matching a real brute-force
    // attempt, then prove the 6th call is blocked even with valid creds.
    for (let i = 0; i < 5; i++) {
      await provider.authorize({ password: "wrong" }, reqWithIp(ip));
    }
    const result = await provider.authorize(
      { password: "correct-horse" },
      reqWithIp(ip)
    );
    expect(result).toBeNull();
  });
});
