import type { NextAuthOptions } from "next-auth";
import { consumeAttempt, clearAttempts, LOGIN_MAX_ATTEMPTS } from "@/lib/services/rate-limit";
import { AUDIT, recordAuditEvent } from "@/lib/services/audit-log";
import { decryptSecret } from "@/lib/domain/crypto-at-rest";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { verifyTotpCode, matchBackupCode } from "@/lib/domain/totp";
import { OWNER_USER_ID } from "@/lib/domain/users";
import { TOTP_REQUIRED } from "@/lib/domain/auth-constants";


// Compared against when no account matched, so an unknown username costs the
// same bcrypt work as a real one. Without it, resolveUser returned
// immediately for an unknown username and only paid for bcrypt on a real
// one - measured at a ~64ms gap over localhost during the post-v2.0 security
// audit, far above the noise floor and a reliable username-enumeration
// oracle. The rate limiter bounds how fast that can be probed but does not
// close it, since a timing probe only needs a response, not a success.
//
// Hashed from fresh random bytes at module load rather than a checked-in
// constant: nothing can ever match it, and there is no literal in the repo
// that looks like a credential.
const UNMATCHED_USER_HASH = bcrypt.hashSync(randomBytes(32).toString("hex"), 10);

// x-forwarded-for/x-real-ip are only trustworthy behind a reverse proxy that
// sets them itself (Nginx Proxy Manager, Caddy, Traefik, Cloudflare - see
// README "Securing access"). Without one in front, a direct client can set
// these headers to whatever it wants, same as it could previously spoof the
// old client-supplied `ip` credential field - this is the same baseline
// every self-hosted app without a trusted-proxy allowlist has, not a
// regression. The fix here closes the much worse prior bug: the client
// literally hardcoded a constant string, so every visitor shared one
// rate-limit bucket and the limit couldn't distinguish anyone at all.
export function getClientIp(headers: Record<string, unknown> | undefined): string {
  const forwardedFor = headers?.["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }
  const realIp = headers?.["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) return realIp.trim();
  return "unknown";
}

type AuthUser = {
  id: string;
  role: "ADMIN" | "MEMBER";
  totpSecret: string | null;
  totpEnabled: boolean;
  totpBackupCodes: string[];
  passwordHash: string | null;
};

/**
 * Resolve the login attempt to a user, verifying the password.
 *
 * Password precedence (v2.0): a DB hash wins absolutely. Once a user has one,
 * the env AUTH_PASSWORD/AUTH_PASSWORD_HASH is ignored entirely for them -
 * having two simultaneously-valid passwords for the same account would make
 * the weaker one the real security level, and an env password can't be rotated
 * or revoked per-user. The env credential therefore only ever authenticates
 * the owner, and only while the owner has no DB password yet. That's what
 * keeps an existing AUTH_ENABLED install logging in unchanged the moment it
 * upgrades to v2.0, with no forced migration step.
 */
async function resolveUser(username: string | undefined, password: string): Promise<AuthUser | null> {
  const select = {
    id: true,
    role: true,
    totpSecret: true,
    totpEnabled: true,
    totpBackupCodes: true,
    passwordHash: true,
  } as const;

  // No username submitted = the legacy password-only form (mono-mode installs
  // that never created a real account). Only the owner can be meant.
  const user = username
    ? await prisma.user.findUnique({ where: { username }, select })
    : await prisma.user.findUnique({ where: { id: OWNER_USER_ID }, select });
  if (!user) {
    // Burn the same bcrypt cost a real account would - see UNMATCHED_USER_HASH.
    await bcrypt.compare(password, UNMATCHED_USER_HASH);
    return null;
  }

  if (user.passwordHash) {
    return (await bcrypt.compare(password, user.passwordHash)) ? user : null;
  }

  // No DB password: the env fallback applies, and only to the owner.
  if (user.id !== OWNER_USER_ID) {
    await bcrypt.compare(password, UNMATCHED_USER_HASH);
    return null;
  }

  const storedHash = process.env.AUTH_PASSWORD_HASH;
  if (storedHash) return (await bcrypt.compare(password, storedHash)) ? user : null;

  const plain = process.env.AUTH_PASSWORD;
  if (!plain || password !== plain) return null;
  return user;
}

/**
 * 2FA, if enabled - re-checked server-side (never trust the client's
 * totpEnabled prop, which only decided whether to render the code field).
 * Per-user as of v2.0; a user with 2FA off is unaffected.
 */
async function verifySecondFactor(user: AuthUser, code: string): Promise<boolean> {
  if (!user.totpEnabled || !user.totpSecret) return true;

  if (await verifyTotpCode(decryptSecret(user.totpSecret)!, code)) return true;

  const backupIndex = await matchBackupCode(code, user.totpBackupCodes);
  if (backupIndex === -1) return false;

  // Consume the backup code so it can't be reused.
  await prisma.user.update({
    where: { id: user.id },
    data: { totpBackupCodes: user.totpBackupCodes.filter((_, i) => i !== backupIndex) },
  });
  return true;
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        username: { label: "Identifiant", type: "text" },
        password: { label: "Mot de passe", type: "password" },
        totpCode: { label: "Code de vérification", type: "text" },
      },
      async authorize(credentials, req) {
        const password = credentials?.password as string;
        if (!password) return null;

        const username = ((credentials?.username as string) || "").trim() || undefined;
        const ip = getClientIp(req?.headers);
        // Keyed per (ip, username), not ip alone: with several accounts on
        // one instance, an ip-only bucket lets one attacker's failures lock
        // out every other user behind the same NAT/reverse proxy.
        const bucket = `login|${ip}|${username ?? OWNER_USER_ID}`;
        if (!(await consumeAttempt(bucket, LOGIN_MAX_ATTEMPTS))) {
          await recordAuditEvent({
            action: AUDIT.loginRateLimited, actorLabel: username ?? null, ip,
          });
          return null;
        }

        const user = await resolveUser(username, password);
        if (!user) {
          await recordAuditEvent({ action: AUDIT.loginFailed, actorLabel: username ?? null, ip });
          return null;
        }

        const code = (credentials?.totpCode as string) || "";
        // Password accepted, code needed and not supplied: say so, so the form
        // can move to its second step. See TOTP_REQUIRED.
        if (user.totpEnabled && user.totpSecret && !code) throw new Error(TOTP_REQUIRED);

        if (!(await verifySecondFactor(user, code))) {
          await recordAuditEvent({
            action: AUDIT.loginFailed, actorId: user.id, actorLabel: username ?? null, ip,
            detail: "second factor rejected",
          });
          return null;
        }

        // Cleared on success, so someone who mistyped twice is not still one
        // attempt from a lockout an hour later.
        await clearAttempts(bucket);
        await recordAuditEvent({
          action: AUDIT.loginSucceeded, actorId: user.id, actorLabel: username ?? null, ip,
        });
        return { id: user.id, name: process.env.AUTH_USER_NAME ?? "owner", role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = (user as { id: string }).id;
        token.role = (user as { role?: string }).role ?? "MEMBER";
      }
      // A token with no userId is a pre-v2 session still live in a browser
      // (the old one only carried `sub: "owner"`). Map it to the owner rather
      // than invalidating it, so upgrading doesn't log everyone out.
      token.userId ??= OWNER_USER_ID;
      token.role ??= "ADMIN";
      // Stamped once, at issue: getViewer compares it against the user's own
      // sessionsRevokedAt so a session can be ended without deleting the
      // account. NextAuth sets `iat` itself but re-stamps it on refresh,
      // which would let a revoked session renew its way back in.
      (token as { issuedAt?: number }).issuedAt ??= Math.floor(Date.now() / 1000);
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.userId as string;
        (session.user as { role?: string }).role = token.role as string;
        (session.user as { issuedAt?: number }).issuedAt = (token as { issuedAt?: number }).issuedAt;
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 jours
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
