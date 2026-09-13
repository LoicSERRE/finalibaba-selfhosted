"use server";

import { revalidatePath } from "next/cache";
import { decryptSecret, encryptSecret, tokenLookupHash } from "@/lib/domain/crypto-at-rest";
import { prisma } from "@/lib/db/prisma";
import { getViewer, assertOwned } from "@/lib/auth-context";
import { generateShareToken } from "@/lib/domain/share-links";

export async function getShareLinks() {
  const viewer = await getViewer();
  const rows = await prisma.shareLink.findMany({ where: { userId: viewer.id }, orderBy: { createdAt: "desc" } });
  // Decrypted for display: a share link stays re-copyable rather than shown
  // once, which is the documented behaviour (see CLAUDE.md).
  return rows.map((r) => ({ ...r, token: decryptSecret(r.token)! }));
}

// expiresInDays is resolved to a concrete Date here, at creation time - not
// stored as a duration, so a link's expiry doesn't drift if the server clock
// or the reader's notion of "now" changes later.
//
// includeHoldings/includeTransactions are opt-in per link, default off in
// the form below - see the schema comment on ShareLink for why. Set once at
// creation, same as label/expiresAt - no update path exists for any of
// these fields, revoke and recreate the link to change them.
export async function createShareLink(
  label: string | null,
  expiresInDays: number | null,
  includeHoldings: boolean,
  includeTransactions: boolean,
) {
  const expiresAt = expiresInDays !== null ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;

  const viewer = await getViewer();
  await prisma.shareLink.create({
    data: {
      userId: viewer.id,
      // Encrypted, with a digest beside it: app/shared/[token]/page.tsx finds
      // the row by that digest, and Settings decrypts to show the link again.
      ...tokenColumns(generateShareToken()),
      label: label?.trim() || null, expiresAt, includeHoldings, includeTransactions },
  });

  revalidatePath("/settings");
}

// Hard delete - no soft-delete/history value for a revoked share link, unlike
// e.g. Sale's record-only deletion (lib/actions/sales.ts).
export async function revokeShareLink(id: string) {
  const viewer = await getViewer();
  await assertOwned("shareLink", id, viewer.id);
  await prisma.shareLink.delete({ where: { id } });
  revalidatePath("/settings");
}

/** The pair every token column now needs: the encrypted value and its digest. */
function tokenColumns(token: string) {
  return { token: encryptSecret(token)!, tokenHash: tokenLookupHash(token) };
}
