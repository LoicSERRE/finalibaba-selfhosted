"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseCents } from "@/lib/format";
import Decimal from "decimal.js";

export async function upsertHolding(formData: FormData) {
  const accountId = formData.get("accountId") as string;
  const ticker = (formData.get("ticker") as string).trim().toUpperCase();
  const name = (formData.get("name") as string).trim();
  const quantity = new Decimal(formData.get("quantity") as string);
  const lastPriceCents = parseCents(formData.get("price") as string);
  const costBasisStr = formData.get("costBasis") as string | null;
  const costBasisCents = costBasisStr && costBasisStr.trim() !== "" ? parseCents(costBasisStr) : null;
  const targetPctStr = formData.get("targetPct") as string | null;
  const targetPct = targetPctStr && targetPctStr.trim() !== "" ? Math.min(1, Math.max(0, parseFloat(targetPctStr) / 100)) : null;

  await prisma.holding.upsert({
    where: { accountId_ticker: { accountId, ticker } },
    create: {
      accountId,
      ticker,
      name,
      quantity,
      lastPriceCents,
      costBasisCents: costBasisCents ?? undefined,
      targetPct: targetPct ?? undefined,
    },
    update: {
      name,
      quantity,
      lastPriceCents,
      // Only update costBasis/targetPct if explicitly provided - blank
      // leaves a previously-set value untouched, same convention for both.
      ...(costBasisCents !== null ? { costBasisCents } : {}),
      ...(targetPct !== null ? { targetPct } : {}),
    },
  });

  await refreshAccountBalance(accountId);

  revalidatePath("/accounts");
  revalidatePath("/analytics");
  revalidatePath("/");
}

export async function deleteHolding(id: string, accountId: string) {
  await prisma.holding.delete({ where: { id } });
  await refreshAccountBalance(accountId);
  revalidatePath("/accounts");
  revalidatePath("/analytics");
  revalidatePath("/");
}

export async function refreshAccountBalance(accountId: string) {
  const holdings = await prisma.holding.findMany({ where: { accountId } });
  const totalCents = holdings.reduce((sum, h) => {
    const value = new Decimal(h.quantity.toString())
      .mul(new Decimal(h.lastPriceCents.toString()))
      .round()
      .toNumber();
    return sum + BigInt(value);
  }, BigInt(0));

  await prisma.historicalBalance.create({
    data: { accountId, balanceCents: totalCents },
  });
}
