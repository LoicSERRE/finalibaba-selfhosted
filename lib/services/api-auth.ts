import { NextRequest } from "next/server";
import { tokenLookupHash } from "@/lib/domain/crypto-at-rest";
import { prisma } from "@/lib/db/prisma";
import { isAuthEnabled } from "@/lib/auth-context";
import { requiresTwoFactor } from "@/lib/services/two-factor-policy";

// Shared gate for every app/api/v1/* route - see CLAUDE.md's "Public REST
// API". Deliberately its own lookup, not the internal bearer-token
// pattern app/api/alerts/check/route.ts uses: that token must stay
// strictly internal (app<->sync containers, same trust level as session
// forgery), never handed to a third-party tool like Home Assistant. An
// ApiKey is a separate, individually revocable credential precisely so a
// leaked or retired integration can be cut off without rotating
// NEXTAUTH_SECRET (which would also kill every logged-in session).
//
// Returns the matched key's id AND its owner on success, or null on failure -
// never throws, callers respond 401 themselves so every route's error shape
// stays consistent JSON, not a framework default.
//
// The userId is what every v1 route scopes its queries by (v2.0). Before that
// an API key granted the ENTIRE instance's data regardless of who created it,
// which in multi-user would make a key minted by any member a full read of
// everyone's finances.
export async function authenticateApiKey(
  req: NextRequest,
): Promise<{ id: string; userId: string } | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length);
  if (!token) return null;

  const row = await prisma.apiKey.findUnique({
    where: { tokenHash: tokenLookupHash(token) },
    select: { id: true, userId: true, user: { select: { totpEnabled: true } } },
  });
  if (!row) return null;
  // The instance 2FA policy, which getViewer applies to sessions: a key minted
  // before the policy was switched on (or by a user who has since turned 2FA
  // off) must not stay a password-only way into the data.
  if (isAuthEnabled() && !row.user.totpEnabled && (await requiresTwoFactor())) return null;
  const key = { id: row.id, userId: row.userId };

  // Fire-and-forget: a failed lastUsedAt write shouldn't fail the actual
  // request the caller is waiting on.
  prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  return key;
}
