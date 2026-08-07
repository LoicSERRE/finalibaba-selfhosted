import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { verifyTotpCode, matchBackupCode } from "@/lib/domain/totp";

// Simple in-memory rate limiter - max 5 attempts per 15 min per IP.
// Wrapped in a factory (rather than one module-level Map) so tests can each
// get a fresh, isolated limiter instead of sharing mutable state.
export function createRateLimiter(maxAttempts = 5, windowMs = 15 * 60 * 1000) {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return function checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = attempts.get(ip);
    if (!entry || now > entry.resetAt) {
      attempts.set(ip, { count: 1, resetAt: now + windowMs });
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

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        password: { label: "Mot de passe", type: "password" },
        totpCode: { label: "Code de vérification", type: "text" },
      },
      async authorize(credentials, req) {
        const ip = getClientIp(req?.headers);
        if (!checkRateLimit(ip)) return null;

        const password = credentials?.password as string;
        if (!password) return null;

        const storedHash = process.env.AUTH_PASSWORD_HASH;
        if (storedHash) {
          const valid = await bcrypt.compare(password, storedHash);
          if (!valid) return null;
        } else {
          const plain = process.env.AUTH_PASSWORD;
          if (!plain || password !== plain) return null;
        }

        // 2FA, if enabled - re-checked server-side (never trust the
        // client's totpEnabled prop that just decided whether to render
        // the code field). No UserSettings row yet, or 2FA never enabled:
        // behavior is unchanged from before this feature existed.
        const settings = await prisma.userSettings.findUnique({
          where: { id: "singleton" },
          select: { totpEnabled: true, totpSecret: true, totpBackupCodes: true },
        });

        if (settings?.totpEnabled && settings.totpSecret) {
          const code = (credentials?.totpCode as string) || "";
          const isValidTotp = await verifyTotpCode(settings.totpSecret, code);
          if (!isValidTotp) {
            const backupIndex = await matchBackupCode(code, settings.totpBackupCodes);
            if (backupIndex === -1) return null;
            // Consume the backup code so it can't be reused.
            const remaining = settings.totpBackupCodes.filter((_, i) => i !== backupIndex);
            await prisma.userSettings.update({
              where: { id: "singleton" },
              data: { totpBackupCodes: remaining },
            });
          }
        }

        return { id: "owner", name: process.env.AUTH_USER_NAME ?? "owner" };
      },
    }),
  ],
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
