"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseCents } from "@/lib/format";

export async function recordBalance(formData: FormData) {
  const accountId = formData.get("accountId") as string;
  const balanceStr = formData.get("balance") as string;
  const balanceCents = parseCents(balanceStr);

  await prisma.historicalBalance.create({
    data: { accountId, balanceCents },
  });

  revalidatePath("/banks");
  revalidatePath("/");
}
