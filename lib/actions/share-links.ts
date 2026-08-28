"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getViewer, assertOwned } from "@/lib/auth-context";
import { generateShareToken } from "@/lib/domain/share-links";

export async function getShareLinks() {
  const viewer = await getViewer();
  return prisma.shareLink.findMany({ where: { userId: viewer.id }, orderBy: { createdAt: "desc" } });
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
      userId: viewer.id, token: generateShareToken(), label: label?.trim() || null, expiresAt, includeHoldings, includeTransactions },
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
