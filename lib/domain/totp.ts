import { generateSecret, generateURI, verify } from "otplib";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

export function generateTotpSecret(): string {
  return generateSecret();
}

export function generateTotpUri(secret: string, accountLabel: string): string {
  return generateURI({ issuer: "Finalibaba", label: accountLabel, secret });
}

// epochTolerance is not optional here - otplib's own default is 0 (the
// exact current 30s window only), which would reject a correct code on any
// client/server clock drift. 30s of slack either side is the conventional
// TOTP tolerance every authenticator app already expects servers to allow.
export async function verifyTotpCode(secret: string, token: string): Promise<boolean> {
  if (!token) return false;
  try {
    // otplib's verify() THROWS (not just returns { valid: false }) for a
    // token that isn't exactly 6 digits - e.g. a backup code shaped
    // "xxxxx-xxxxx" reaching this function first in authorize()'s fallback
    // chain. Confirmed empirically (TokenLengthError) - without this catch,
    // a login attempt with a backup code would 500 instead of falling
    // through to the backup-code check.
    const result = await verify({ secret, token, epochTolerance: 30 });
    return result.valid;
  } catch {
    return false;
  }
}

const BACKUP_CODE_COUNT = 8;
const BCRYPT_COST = 10; // matches the AUTH_PASSWORD_HASH cost documented in README.md

export function generateBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const raw = randomBytes(5).toString("hex"); // 10 hex chars
    return `${raw.slice(0, 5)}-${raw.slice(5)}`; // "a1b2c-3d4e5"
  });
}

export function normalizeBackupCode(input: string): string {
  return input.toLowerCase().replace(/[^0-9a-f]/g, "");
}

export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => bcrypt.hash(normalizeBackupCode(c), BCRYPT_COST)));
}

/**
 * Index of the matching hash in `hashedCodes`, or -1. Pure - has no I/O and
 * does not mutate anything, so consuming (removing) a matched code is the
 * caller's responsibility once it has the index.
 */
export async function matchBackupCode(candidate: string, hashedCodes: string[]): Promise<number> {
  const normalized = normalizeBackupCode(candidate);
  if (normalized.length !== 10) return -1;
  for (let i = 0; i < hashedCodes.length; i++) {
    if (await bcrypt.compare(normalized, hashedCodes[i])) return i;
  }
  return -1;
}
