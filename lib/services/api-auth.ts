import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";

// Shared gate for every app/api/v1/* route - see CLAUDE.md's "Public REST
// API". Deliberately its own lookup, not the NEXTAUTH_SECRET bearer-token
// pattern app/api/alerts/check/route.ts uses: that secret must stay
// strictly internal (app<->sync containers, same trust level as session
// forgery), never handed to a third-party tool like Home Assistant. An
// ApiKey is a separate, individually revocable credential precisely so a
// leaked or retired integration can be cut off without rotating
// NEXTAUTH_SECRET (which would also kill every logged-in session).
//
// Returns the matched key's id on success (so a route can skip the
// lastUsedAt bookkeeping write if it wants to, though none currently do) or
// null on failure - never throws, callers respond 401 themselves so every
// route's error shape stays consistent JSON, not a framework default.
export async function authenticateApiKey(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length);
  if (!token) return null;

  const key = await prisma.apiKey.findUnique({ where: { token }, select: { id: true } });
  if (!key) return null;

  // Fire-and-forget: a failed lastUsedAt write shouldn't fail the actual
  // request the caller is waiting on.
  prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  return key.id;
}
