"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { generateApiKeyToken } from "@/lib/domain/api-keys";

export async function getApiKeys() {
  return prisma.apiKey.findMany({ orderBy: { createdAt: "desc" } });
}

export async function createApiKey(label: string | null) {
  await prisma.apiKey.create({
    data: { token: generateApiKeyToken(), label: label?.trim() || null },
  });
  revalidatePath("/settings");
}

// Hard delete - no soft-delete/history value for a revoked key, same
// reasoning as revokeShareLink.
export async function revokeApiKey(id: string) {
  await prisma.apiKey.delete({ where: { id } });
  revalidatePath("/settings");
}
