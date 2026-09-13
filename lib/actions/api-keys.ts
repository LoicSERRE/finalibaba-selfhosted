"use server";

import { revalidatePath } from "next/cache";
import { decryptSecret, encryptSecret, tokenLookupHash } from "@/lib/domain/crypto-at-rest";
import { prisma } from "@/lib/db/prisma";
import { getViewer, assertOwned } from "@/lib/auth-context";
import { generateApiKeyToken } from "@/lib/domain/api-keys";

export async function getApiKeys() {
  const viewer = await getViewer();
  const rows = await prisma.apiKey.findMany({ where: { userId: viewer.id }, orderBy: { createdAt: "desc" } });
  // Decrypted for display: an API key stays re-copyable rather than shown
  // once, matching ShareLink's own precedent.
  return rows.map((r) => ({ ...r, token: decryptSecret(r.token)! }));
}

export async function createApiKey(label: string | null) {
  const viewer = await getViewer();
  await prisma.apiKey.create({
    data: {
      userId: viewer.id,
      ...tokenColumns(generateApiKeyToken()),
      label: label?.trim() || null },
  });
  revalidatePath("/settings");
}

// Hard delete - no soft-delete/history value for a revoked key, same
// reasoning as revokeShareLink.
export async function revokeApiKey(id: string) {
  const viewer = await getViewer();
  await assertOwned("apiKey", id, viewer.id);
  await prisma.apiKey.delete({ where: { id } });
  revalidatePath("/settings");
}

/** The pair every token column now needs: the encrypted value and its digest. */
function tokenColumns(token: string) {
  return { token: encryptSecret(token)!, tokenHash: tokenLookupHash(token) };
}
