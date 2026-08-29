"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getViewer, assertOwned } from "@/lib/auth-context";
import { generateApiKeyToken } from "@/lib/domain/api-keys";

export async function getApiKeys() {
  const viewer = await getViewer();
  return prisma.apiKey.findMany({ where: { userId: viewer.id }, orderBy: { createdAt: "desc" } });
}

export async function createApiKey(label: string | null) {
  const viewer = await getViewer();
  await prisma.apiKey.create({
    data: {
      userId: viewer.id, token: generateApiKeyToken(), label: label?.trim() || null },
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
