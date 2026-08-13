"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { generateShareToken } from "@/lib/domain/share-links";

export async function getShareLinks() {
  return prisma.shareLink.findMany({ orderBy: { createdAt: "desc" } });
}

// expiresInDays is resolved to a concrete Date here, at creation time - not
// stored as a duration, so a link's expiry doesn't drift if the server clock
// or the reader's notion of "now" changes later.
export async function createShareLink(label: string | null, expiresInDays: number | null) {
  const expiresAt = expiresInDays !== null ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;

  await prisma.shareLink.create({
    data: { token: generateShareToken(), label: label?.trim() || null, expiresAt },
  });

  revalidatePath("/settings");
}

// Hard delete - no soft-delete/history value for a revoked share link, unlike
// e.g. Sale's record-only deletion (lib/actions/sales.ts).
export async function revokeShareLink(id: string) {
  await prisma.shareLink.delete({ where: { id } });
  revalidatePath("/settings");
}
