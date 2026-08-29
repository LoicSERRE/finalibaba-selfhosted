import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { generate as generateTotpToken } from "otplib";
import type { CredentialsConfig } from "next-auth/providers/credentials";
import { generateTotpSecret, generateBackupCodes, hashBackupCodes } from "@/lib/domain/totp";

// Hoisted so the vi.mock factory below can reference them (vi.mock calls are
// hoisted above imports by vitest) - every pre-existing test in this file
// gets the safe "2FA not enabled" default via the beforeEach reset below,
// only the new describe block overrides it per-case.
const { findUniqueMock, updateMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
}));

// As of v2.0 authorize() resolves a real User row (TOTP moved there from the
// old UserSettings singleton), so the mock stands in for prisma.user.
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: {
      findUnique: findUniqueMock,
      update: updateMock,
    },
  },
}));

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

// Default: the owner, with no DB password (so the env AUTH_PASSWORD/
// AUTH_PASSWORD_HASH fallback applies, which is what these tests exercise)
// and 2FA off - keeps every pre-existing password-only test in this file
// passing unchanged.
const OWNER_ROW = {
  id: "user-owner",
  role: "ADMIN" as const,
  passwordHash: null,
  totpEnabled: false,
  totpSecret: null,
  totpBackupCodes: [] as string[],
};

beforeEach(() => {
  findUniqueMock.mockReset().mockResolvedValue({ ...OWNER_ROW });
  updateMock.mockReset().mockResolvedValue({});
});

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
    expect(result).toEqual({ id: "user-owner", name: "owner", role: "ADMIN" });
  });

  it("uses AUTH_USER_NAME as the display name when set", async () => {
    vi.stubEnv("AUTH_PASSWORD", "correct-horse");
    vi.stubEnv("AUTH_USER_NAME", "Loïc");
    const result = await provider.authorize(
      { password: "correct-horse" },
      reqWithIp(nextIp())
    );
    expect(result).toEqual({ id: "user-owner", name: "Loïc", role: "ADMIN" });
  });

  it("prefers AUTH_PASSWORD_HASH over AUTH_PASSWORD when both are set (bcrypt path)", async () => {
    const hash = await bcrypt.hash("correct-horse", 4);
    vi.stubEnv("AUTH_PASSWORD_HASH", hash);
    vi.stubEnv("AUTH_PASSWORD", "this-plaintext-must-be-ignored");
    const result = await provider.authorize(
      { password: "correct-horse" },
      reqWithIp(nextIp())
    );
    expect(result).toEqual({ id: "user-owner", name: "owner", role: "ADMIN" });
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

describe("authOptions credentials provider - authorize() with 2FA", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("skips the 2FA check when totpEnabled is false - regression, unchanged behavior", async () => {
    vi.stubEnv("AUTH_PASSWORD", "correct-horse");
    findUniqueMock.mockResolvedValueOnce({ ...OWNER_ROW, totpEnabled: false, totpSecret: null, totpBackupCodes: [] });
    const result = await provider.authorize({ password: "correct-horse" }, reqWithIp(nextIp()));
    expect(result).toEqual({ id: "user-owner", name: "owner", role: "ADMIN" });
  });

  it("returns null when the owner row is missing entirely (un-migrated DB) rather than authenticating anyway", async () => {
    vi.stubEnv("AUTH_PASSWORD", "correct-horse");
    findUniqueMock.mockResolvedValueOnce(null);
    const result = await provider.authorize({ password: "correct-horse" }, reqWithIp(nextIp()));
    expect(result).toBeNull();
  });

  it("returns the owner user when the password and a correct TOTP code are both provided", async () => {
    vi.stubEnv("AUTH_PASSWORD", "correct-horse");
    const secret = generateTotpSecret();
    const token = await generateTotpToken({ secret });
    findUniqueMock.mockResolvedValueOnce({ ...OWNER_ROW, totpEnabled: true, totpSecret: secret, totpBackupCodes: [] });
    const result = await provider.authorize(
      { password: "correct-horse", totpCode: token },
      reqWithIp(nextIp())
    );
    expect(result).toEqual({ id: "user-owner", name: "owner", role: "ADMIN" });
  });

  it("returns null when the password is correct but the TOTP code is wrong", async () => {
    vi.stubEnv("AUTH_PASSWORD", "correct-horse");
    const secret = generateTotpSecret();
    findUniqueMock.mockResolvedValueOnce({ ...OWNER_ROW, totpEnabled: true, totpSecret: secret, totpBackupCodes: [] });
    const result = await provider.authorize(
      { password: "correct-horse", totpCode: "000000" },
      reqWithIp(nextIp())
    );
    expect(result).toBeNull();
  });

  it("returns null when the password is correct but no TOTP code is provided", async () => {
    vi.stubEnv("AUTH_PASSWORD", "correct-horse");
    const secret = generateTotpSecret();
    findUniqueMock.mockResolvedValueOnce({ ...OWNER_ROW, totpEnabled: true, totpSecret: secret, totpBackupCodes: [] });
    const result = await provider.authorize({ password: "correct-horse" }, reqWithIp(nextIp()));
    expect(result).toBeNull();
  });

  it("accepts a valid unused backup code and consumes it (removed from the stored array)", async () => {
    vi.stubEnv("AUTH_PASSWORD", "correct-horse");
    const secret = generateTotpSecret();
    const backupCodes = generateBackupCodes();
    const hashed = await hashBackupCodes(backupCodes);
    findUniqueMock.mockResolvedValueOnce({ ...OWNER_ROW, totpEnabled: true, totpSecret: secret, totpBackupCodes: hashed });

    const result = await provider.authorize(
      { password: "correct-horse", totpCode: backupCodes[0] },
      reqWithIp(nextIp())
    );

    expect(result).toEqual({ id: "user-owner", name: "owner", role: "ADMIN" });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "user-owner" },
      data: { totpBackupCodes: hashed.filter((_, i) => i !== 0) },
    });
  });

  it("rejects an already-consumed backup code (not present in the stored array)", async () => {
    vi.stubEnv("AUTH_PASSWORD", "correct-horse");
    const secret = generateTotpSecret();
    const backupCodes = generateBackupCodes();
    const hashed = await hashBackupCodes(backupCodes);
    const remaining = hashed.slice(1); // codes[0] already consumed in a prior login
    findUniqueMock.mockResolvedValueOnce({ ...OWNER_ROW, totpEnabled: true, totpSecret: secret, totpBackupCodes: remaining });

    const result = await provider.authorize(
      { password: "correct-horse", totpCode: backupCodes[0] },
      reqWithIp(nextIp())
    );

    expect(result).toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
  });
});

// ── v2.0 multi-user: password precedence & per-user resolution ──────────────
//
// The rule these lock in: a DB password hash wins absolutely. Once a user has
// one, the env AUTH_PASSWORD/AUTH_PASSWORD_HASH is ignored entirely for them -
// two simultaneously-valid passwords for one account would make the weaker one
// the real security level, and an env credential can't be rotated per-user.
// The env fallback therefore only ever authenticates the owner, and only while
// the owner has no DB password of their own.
describe("authorize() - v2.0 password precedence", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the DB hash and IGNORES a conflicting env password once the user has one", async () => {
    vi.stubEnv("AUTH_PASSWORD", "env-password");
    const dbHash = await bcrypt.hash("db-password", 10);
    findUniqueMock.mockResolvedValue({ ...OWNER_ROW, username: "loic", passwordHash: dbHash });

    const viaEnv = await provider.authorize(
      { username: "loic", password: "env-password" },
      reqWithIp(nextIp())
    );
    expect(viaEnv).toBeNull();

    const viaDb = await provider.authorize(
      { username: "loic", password: "db-password" },
      reqWithIp(nextIp())
    );
    expect(viaDb).toEqual({ id: "user-owner", name: "owner", role: "ADMIN" });
  });

  it("falls back to the env password only while the owner has no DB hash", async () => {
    vi.stubEnv("AUTH_PASSWORD", "env-password");
    findUniqueMock.mockResolvedValue({ ...OWNER_ROW, passwordHash: null });

    const result = await provider.authorize({ password: "env-password" }, reqWithIp(nextIp()));
    expect(result).toEqual({ id: "user-owner", name: "owner", role: "ADMIN" });
  });

  it("never lets the env password authenticate a non-owner user", async () => {
    vi.stubEnv("AUTH_PASSWORD", "env-password");
    // A member with no DB password yet (invited but never completed setup):
    // the env credential is the owner's, so it must not open their account.
    findUniqueMock.mockResolvedValue({
      ...OWNER_ROW,
      id: "user-partner",
      role: "MEMBER",
      username: "partner",
      passwordHash: null,
    });

    const result = await provider.authorize(
      { username: "partner", password: "env-password" },
      reqWithIp(nextIp())
    );
    expect(result).toBeNull();
  });

  it("returns the authenticated user's own id and role, not a hardcoded owner", async () => {
    const dbHash = await bcrypt.hash("partner-password", 10);
    findUniqueMock.mockResolvedValue({
      ...OWNER_ROW,
      id: "user-partner",
      role: "MEMBER",
      username: "partner",
      passwordHash: dbHash,
    });

    const result = await provider.authorize(
      { username: "partner", password: "partner-password" },
      reqWithIp(nextIp())
    );
    expect(result).toEqual({ id: "user-partner", name: "owner", role: "MEMBER" });
  });

  it("returns null for an unknown username instead of falling through to the owner", async () => {
    vi.stubEnv("AUTH_PASSWORD", "env-password");
    findUniqueMock.mockResolvedValue(null);

    const result = await provider.authorize(
      { username: "nobody", password: "env-password" },
      reqWithIp(nextIp())
    );
    expect(result).toBeNull();
  });
});
