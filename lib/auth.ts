import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { verifyTotpCode, matchBackupCode } from "@/lib/domain/totp";
import { OWNER_USER_ID } from "@/lib/domain/users";

// Simple in-memory rate limiter - max 5 attempts per 15 min per IP.
// Wrapped in a factory (rather than one module-level Map) so tests can each
// get a fresh, isolated limiter instead of sharing mutable state.
export function createRateLimiter(maxAttempts = 5, windowMs = 15 * 60 * 1000) {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return function checkRateLimit(key: string): boolean {
    const now = Date.now();
    const entry = attempts.get(key);
    if (!entry || now > entry.resetAt) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (entry.count >= maxAttempts) return false;
    entry.count++;
    return true;
  };
}

const checkRateLimit = createRateLimiter();

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
  if (!user) return null;

  if (user.passwordHash) {
    return (await bcrypt.compare(password, user.passwordHash)) ? user : null;
  }

  // No DB password: the env fallback applies, and only to the owner.
  if (user.id !== OWNER_USER_ID) return null;

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

  if (await verifyTotpCode(user.totpSecret, code)) return true;

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
        // Keyed per (ip, username), not ip alone: with several accounts on
        // one instance, an ip-only bucket lets one attacker's failures lock
        // out every other user behind the same NAT/reverse proxy.
        if (!checkRateLimit(`${getClientIp(req?.headers)}|${username ?? OWNER_USER_ID}`)) return null;

        const user = await resolveUser(username, password);
        if (!user) return null;

        if (!(await verifySecondFactor(user, (credentials?.totpCode as string) || ""))) return null;

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
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.userId as string;
        (session.user as { role?: string }).role = token.role as string;
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
