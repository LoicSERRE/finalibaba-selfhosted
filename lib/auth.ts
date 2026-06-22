import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

// Simple in-memory rate limiter — max 5 attempts per 15 min per IP
const attempts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 5) return false;
  entry.count++;
  return true;
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        password: { label: "Mot de passe", type: "password" },
        ip: { label: "ip", type: "text" },
      },
      async authorize(credentials) {
        const ip = (credentials?.ip as string) || "unknown";
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

        return { id: "owner", name: process.env.AUTH_USER_NAME ?? "owner" };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
