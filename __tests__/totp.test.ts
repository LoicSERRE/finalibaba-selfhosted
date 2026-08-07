import { describe, expect, it } from "vitest";
import { generate as generateTotpToken } from "otplib";
import {
  generateTotpSecret,
  generateTotpUri,
  verifyTotpCode,
  generateBackupCodes,
  normalizeBackupCode,
  hashBackupCodes,
  matchBackupCode,
} from "@/lib/domain/totp";

describe("generateTotpSecret / generateTotpUri", () => {
  it("generates a base32 secret otplib itself accepts", async () => {
    const secret = generateTotpSecret();
    const token = await generateTotpToken({ secret });
    expect(token).toMatch(/^\d{6}$/);
  });

  it("builds an otpauth:// URI carrying the issuer, label, and secret", () => {
    const secret = generateTotpSecret();
    const uri = generateTotpUri(secret, "owner");
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain("Finalibaba");
    expect(uri).toContain(secret);
  });
});

describe("verifyTotpCode", () => {
  it("accepts the current valid code for a secret", async () => {
    const secret = generateTotpSecret();
    const token = await generateTotpToken({ secret });
    expect(await verifyTotpCode(secret, token)).toBe(true);
  });

  it("rejects a wrong code", async () => {
    const secret = generateTotpSecret();
    const token = await generateTotpToken({ secret });
    const wrong = token === "000000" ? "111111" : "000000";
    expect(await verifyTotpCode(secret, wrong)).toBe(false);
  });

  it("rejects an empty code without throwing", async () => {
    const secret = generateTotpSecret();
    expect(await verifyTotpCode(secret, "")).toBe(false);
  });

  it("rejects a non-6-digit token (e.g. a backup code) without throwing - otplib's verify() throws TokenLengthError for these, not a graceful invalid result", async () => {
    const secret = generateTotpSecret();
    expect(await verifyTotpCode(secret, "abcde-12345")).toBe(false);
    expect(await verifyTotpCode(secret, "12345")).toBe(false);
    expect(await verifyTotpCode(secret, "1234567")).toBe(false);
  });
});

describe("generateBackupCodes", () => {
  it("generates 8 unique dash-grouped codes", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const c of codes) expect(c).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
  });
});

describe("normalizeBackupCode", () => {
  it("lowercases and strips non-hex characters (dash, whitespace, uppercase)", () => {
    expect(normalizeBackupCode("A1B2C-3D4E5")).toBe("a1b2c3d4e5");
    expect(normalizeBackupCode(" a1b2c 3d4e5 ")).toBe("a1b2c3d4e5");
  });
});

describe("hashBackupCodes / matchBackupCode", () => {
  it("matches a generated code against its own hash, case/dash-insensitively", async () => {
    const codes = generateBackupCodes();
    const hashed = await hashBackupCodes(codes);
    expect(await matchBackupCode(codes[0], hashed)).toBe(0);
    expect(await matchBackupCode(codes[0].toUpperCase(), hashed)).toBe(0);
    expect(await matchBackupCode(codes[0].replace("-", ""), hashed)).toBe(0);
  });

  it("returns -1 for a code that isn't in the array (e.g. already consumed)", async () => {
    const codes = generateBackupCodes();
    const hashed = await hashBackupCodes(codes);
    const remaining = hashed.slice(1);
    expect(await matchBackupCode(codes[0], remaining)).toBe(-1);
  });

  it("returns -1 for a malformed candidate without attempting any bcrypt compare", async () => {
    const hashed = await hashBackupCodes(generateBackupCodes());
    expect(await matchBackupCode("not-a-real-code", hashed)).toBe(-1);
    expect(await matchBackupCode("", hashed)).toBe(-1);
  });
});
