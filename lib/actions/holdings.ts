"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseCents } from "@/lib/format";
import { fetchExchangeRateToEur } from "@/lib/exchange-rate";
import { HoldingCurrency } from "@/app/generated/prisma/enums";
import Decimal from "decimal.js";

const FOREIGN_CURRENCIES = new Set(["USD", "GBP", "CHF"]);

export async function upsertHolding(formData: FormData) {
  const accountId = formData.get("accountId") as string;
  const ticker = (formData.get("ticker") as string).trim().toUpperCase();
  const name = (formData.get("name") as string).trim();
  const quantity = new Decimal(formData.get("quantity") as string);
  const costBasisStr = formData.get("costBasis") as string | null;
  const targetPctStr = formData.get("targetPct") as string | null;
  const targetPct = targetPctStr && targetPctStr.trim() !== "" ? Math.min(1, Math.max(0, parseFloat(targetPctStr) / 100)) : null;

  const currencyRaw = (formData.get("currency") as string | null) || "EUR";
  const currency = (FOREIGN_CURRENCIES.has(currencyRaw) ? currencyRaw : "EUR") as HoldingCurrency;

  // Price/cost basis are always entered in `currency` - converted to EUR
  // cents below when foreign, so every other calculation in the app keeps
  // reading lastPriceCents/costBasisCents as plain EUR, unchanged.
  const nativePriceCents = parseCents(formData.get("price") as string);
  const nativeCostBasisCents = costBasisStr && costBasisStr.trim() !== "" ? parseCents(costBasisStr) : null;

  let lastPriceCents = nativePriceCents;
  let costBasisCents = nativeCostBasisCents;
  let fxRateToEur: number | null = null;

  if (currency !== "EUR") {
    fxRateToEur = await fetchExchangeRateToEur(currency as "USD" | "GBP" | "CHF");
    if (fxRateToEur === null) {
      throw new Error(`Could not fetch the ${currency}→EUR exchange rate - try again or use EUR`);
    }
    lastPriceCents = BigInt(Math.round(Number(nativePriceCents) * fxRateToEur));
    costBasisCents = nativeCostBasisCents !== null ? BigInt(Math.round(Number(nativeCostBasisCents) * fxRateToEur)) : null;
  }

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
      currency,
      nativePriceCents: currency !== "EUR" ? nativePriceCents : undefined,
      nativeCostBasisCents: currency !== "EUR" ? (nativeCostBasisCents ?? undefined) : undefined,
      fxRateToEur: fxRateToEur ?? undefined,
    },
    update: {
      name,
      quantity,
      lastPriceCents,
      currency,
      // Only update costBasis/targetPct if explicitly provided - blank
      // leaves a previously-set value untouched, same convention for both.
      ...(costBasisCents !== null ? { costBasisCents } : {}),
      ...(targetPct !== null ? { targetPct } : {}),
      nativePriceCents: currency !== "EUR" ? nativePriceCents : null,
      nativeCostBasisCents: currency !== "EUR" ? nativeCostBasisCents : null,
      fxRateToEur: currency !== "EUR" ? fxRateToEur : null,
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
