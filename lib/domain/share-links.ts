import { randomBytes } from "node:crypto";

// 256 bits - unlike AUTH_PASSWORD, this is never human-typed, so there's
// nothing to brute-force-guard with a rate limiter the way lib/auth.ts does
// for login attempts. Unguessability comes entirely from entropy.
export function generateShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isShareLinkExpired(expiresAt: Date | null, now: Date = new Date()): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}
