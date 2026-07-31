"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { parseCents } from "@/lib/utils/format";
import { fetchExchangeRateToEur } from "@/lib/services/exchange-rate";
import { HoldingCurrency } from "@/app/generated/prisma/enums";
import Decimal from "decimal.js";

const FOREIGN_CURRENCIES = new Set(["USD", "GBP", "CHF"]);

// Handles both create/edit and both EUR/foreign-currency paths (fetching +
// caching an FX rate only when the native price actually changed) in one
// place - see the "Multi-currency" section of CLAUDE.md for why the
// re-fetch-only-on-change branching can't be simplified further.
// eslint-disable-next-line sonarjs/cognitive-complexity
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

  const existing = await prisma.holding.findUnique({ where: { accountId_ticker: { accountId, ticker } } });

  let lastPriceCents = nativePriceCents;
  let costBasisCents = nativeCostBasisCents;
  let fxRateToEur: number | null = null;

  if (currency !== "EUR") {
    // fxRateToEur is meant to be captured at entry time, not re-rolled on
    // every edit - if the native price/cost basis/currency haven't actually
    // changed, reuse the stored conversion instead of re-fetching (which
    // could silently shift the EUR value on an edit that only touched an
    // unrelated field like targetPct, once the market rate has moved since).
    const unchanged =
      existing !== null &&
      existing.currency === currency &&
      existing.nativePriceCents === nativePriceCents &&
      (existing.nativeCostBasisCents ?? null) === nativeCostBasisCents;

    if (unchanged && existing.fxRateToEur != null) {
      fxRateToEur = existing.fxRateToEur;
      lastPriceCents = existing.lastPriceCents;
      costBasisCents = existing.costBasisCents;
    } else {
      fxRateToEur = await fetchExchangeRateToEur(currency as "USD" | "GBP" | "CHF");
      if (fxRateToEur === null) {
        throw new Error(`Could not fetch the ${currency}→EUR exchange rate - try again or use EUR`);
      }
      lastPriceCents = BigInt(Math.round(Number(nativePriceCents) * fxRateToEur));
      costBasisCents = nativeCostBasisCents !== null ? BigInt(Math.round(Number(nativeCostBasisCents) * fxRateToEur)) : null;
    }
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
