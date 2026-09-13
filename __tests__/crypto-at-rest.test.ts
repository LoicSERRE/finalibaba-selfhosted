import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  isEncrypted,
  ENCRYPTED_PREFIX,
} from "@/lib/domain/crypto-at-rest";

/**
 * These columns hold other people's bank credentials, so the properties worth
 * pinning are the ones whose failure is silent: a value that looks encrypted
 * but is not, a migration that double-wraps on a second run, and a wrong key
 * that returns null instead of raising - which downstream reads as "this user
 * configured no bank password" and simply stops syncing.
 */

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  delete process.env.NEXTAUTH_SECRET;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("round trip", () => {
  it("returns exactly what went in", () => {
    for (const secret of ["hunter2", "mot de passe avec des accents éàü", "0000", "a".repeat(500)]) {
      expect(decryptSecret(encryptSecret(secret))).toBe(secret);
    }
  });

  it("never leaves the plaintext visible in the stored value", () => {
    const stored = encryptSecret("SuperSecretBankPassword");
    expect(stored).not.toContain("SuperSecretBankPassword");
    expect(stored?.startsWith(ENCRYPTED_PREFIX)).toBe(true);
  });

  it("produces a different ciphertext every time for the same input", () => {
    // A fixed IV would make equal passwords visibly equal across rows, which
    // is exactly the inference a dump reader would start from.
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });
});

describe("nullable columns pass straight through", () => {
  it("maps empty and absent to null in both directions", () => {
    for (const empty of [null, undefined, ""]) {
      expect(encryptSecret(empty)).toBeNull();
      expect(decryptSecret(empty)).toBeNull();
    }
  });
});

describe("the migration can be re-run and interrupted", () => {
  it("does not double-wrap an already-encrypted value", () => {
    const once = encryptSecret("pin1234");
    const twice = encryptSecret(once);
    expect(twice).toBe(once);
    expect(decryptSecret(twice)).toBe("pin1234");
  });

  it("reads a not-yet-migrated plaintext row untouched", () => {
    // Mid-migration this is the normal state of most rows. Treating it as an
    // error would take a working instance down while the migration runs.
    expect(decryptSecret("still-in-clear")).toBe("still-in-clear");
    expect(isEncrypted("still-in-clear")).toBe(false);
  });
});

describe("a wrong key fails loudly rather than quietly", () => {
  it("throws instead of returning null when the key changed", () => {
    const stored = encryptSecret("bank-password");
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    expect(() => decryptSecret(stored)).toThrow(/could not decrypt/i);
  });

  it("throws on a tampered payload", () => {
    // GCM authenticates: flipping a byte must be caught, not decrypted into
    // garbage that some caller then sends to a bank.
    const stored = encryptSecret("bank-password")!;
    const [prefix, iv, payload] = [ENCRYPTED_PREFIX, ...stored.slice(ENCRYPTED_PREFIX.length).split(":")];
    const bytes = Buffer.from(payload, "base64");
    bytes[0] ^= 0xff;
    expect(() => decryptSecret(`${prefix}${iv}:${bytes.toString("base64")}`)).toThrow();
  });

  it("rejects a key of the wrong length rather than padding it", () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
    expect(() => encryptSecret("x")).toThrow(/32 base64-encoded bytes/);
  });
});

describe("key resolution", () => {
  it("falls back to NEXTAUTH_SECRET so an upgrade needs no new variable", () => {
    delete process.env.ENCRYPTION_KEY;
    process.env.NEXTAUTH_SECRET = "an-existing-instance-secret";
    expect(decryptSecret(encryptSecret("works"))).toBe("works");
  });

  it("derives a key that is NOT the session secret itself", () => {
    // A leak of one must not hand over the other, which is the whole reason
    // this goes through HKDF rather than using the secret's bytes directly.
    delete process.env.ENCRYPTION_KEY;
    process.env.NEXTAUTH_SECRET = Buffer.alloc(32, 3).toString("base64");
    const viaFallback = encryptSecret("probe");

    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
    expect(() => decryptSecret(viaFallback)).toThrow();
  });

  it("refuses to encrypt with no key at all rather than storing plaintext", () => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.NEXTAUTH_SECRET;
    expect(() => encryptSecret("x")).toThrow(/ENCRYPTION_KEY/);
  });
});

describe("the flows that would lock someone out if this were wrong", () => {
  it("a TOTP secret still verifies a live code after a round trip", async () => {
    // The one failure nobody could work around from the login screen: if the
    // stored secret stops matching what the authenticator app holds, 2FA
    // rejects every correct code and the account is unreachable.
    const { generateTotpSecret, verifyTotpCode } = await import("@/lib/domain/totp");
    const { generate } = await import("otplib");

    const secret = generateTotpSecret();
    const stored = encryptSecret(secret)!;
    const code = await generate({ secret });

    expect(await verifyTotpCode(decryptSecret(stored)!, code)).toBe(true);
    // And the stored form is genuinely opaque rather than merely wrapped.
    expect(stored).not.toContain(secret);
    expect(await verifyTotpCode(stored, code)).toBe(false);
  });

  it("a bank password survives characters a real one actually contains", async () => {
    for (const password of ["p@ssw0rd!", "aé€ü#/\\:", "  leading and trailing  ", "1234"]) {
      expect(decryptSecret(encryptSecret(password))).toBe(password);
    }
  });
});
