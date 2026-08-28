"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getViewer, assertAccountWritable } from "@/lib/auth-context";
import { parseCents } from "@/lib/utils/format";
import { fetchExchangeRateToEur } from "@/lib/services/exchange-rate";
import { HoldingCurrency } from "@/app/generated/prisma/enums";
import Decimal from "decimal.js";

const FOREIGN_CURRENCIES = new Set(["USD", "GBP", "CHF"]);

// Shared by upsertHolding's entry-time conversion and
// refreshHoldingExchangeRate's on-demand one below - same rounding, one
// formula, so a future change to how a native amount becomes EUR cents
// can't drift between the two call sites.
function applyFxRate(nativeCents: bigint, fxRateToEur: number): bigint {
  return BigInt(Math.round(Number(nativeCents) * fxRateToEur));
}

// Handles both create/edit and both EUR/foreign-currency paths (fetching +
// caching an FX rate only when the native price actually changed) in one
// place - see the "Multi-currency" section of CLAUDE.md for why the
// re-fetch-only-on-change branching can't be simplified further.
// eslint-disable-next-line sonarjs/cognitive-complexity
export async function upsertHolding(formData: FormData) {
  const accountId = formData.get("accountId") as string;
  const viewer = await getViewer();
  await assertAccountWritable(viewer.id, accountId);
  const ticker = (formData.get("ticker") as string).trim().toUpperCase();
  const name = (formData.get("name") as string).trim();
  const quantity = new Decimal(formData.get("quantity") as string);
  const costBasisStr = formData.get("costBasis") as string | null;
  const targetPctStr = formData.get("targetPct") as string | null;
  const targetPct = targetPctStr && targetPctStr.trim() !== "" ? Math.min(1, Math.max(0, Number.parseFloat(targetPctStr) / 100)) : null;

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
        throw new Error(`Impossible de récupérer le taux de change ${currency}→EUR - réessaie ou utilise l'EUR.`);
      }
      lastPriceCents = applyFxRate(nativePriceCents, fxRateToEur);
      costBasisCents = nativeCostBasisCents !== null ? applyFxRate(nativeCostBasisCents, fxRateToEur) : null;
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

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/accounts");
  revalidatePath("/analytics");
  revalidatePath("/");
}

export async function deleteHolding(id: string, accountId: string) {
  const viewer = await getViewer();
  await assertAccountWritable(viewer.id, accountId);
  // deleteMany scoped to the account, not delete-by-id: without it a valid
  // accountId of one's own would authorize deleting any holding id at all.
  const { count } = await prisma.holding.deleteMany({ where: { id, accountId } });
  if (count === 0) throw new Error("Position introuvable.");
  await refreshAccountBalance(accountId);
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/accounts");
  revalidatePath("/analytics");
  revalidatePath("/");
}

// On-demand multi-currency revaluation - re-fetches the FX rate and
// recomputes lastPriceCents/costBasisCents from the already-stored
// nativePriceCents/nativeCostBasisCents, without the user having to reopen
// the edit dialog and retype the native price just to force upsertHolding's
// own "only re-fetch when the native price actually changed" branch to run
// (see that function's comment). bypassCache=true on the fetch itself (see
// fetchExchangeRateToEur) - a user who explicitly clicks "refresh" expects
// a genuinely current rate, not whatever was cached up to an hour ago.
export async function refreshHoldingExchangeRate(holdingId: string) {
  const holding = await prisma.holding.findUnique({ where: { id: holdingId } });
  if (!holding) throw new Error("Position introuvable.");
  const viewer = await getViewer();
  await assertAccountWritable(viewer.id, holding.accountId);
  if (holding.currency === "EUR" || holding.nativePriceCents === null) {
    throw new Error("Cette position n'est pas dans une devise étrangère.");
  }

  const fxRateToEur = await fetchExchangeRateToEur(holding.currency as "USD" | "GBP" | "CHF", true);
  if (fxRateToEur === null) {
    throw new Error(`Impossible de récupérer le taux de change ${holding.currency}→EUR - réessaie plus tard.`);
  }

  await prisma.holding.update({
    where: { id: holdingId },
    data: {
      fxRateToEur,
      lastPriceCents: applyFxRate(holding.nativePriceCents, fxRateToEur),
      costBasisCents:
        holding.nativeCostBasisCents !== null ? applyFxRate(holding.nativeCostBasisCents, fxRateToEur) : holding.costBasisCents,
    },
  });

  await refreshAccountBalance(holding.accountId);

  revalidatePath(`/accounts/${holding.accountId}`);
  revalidatePath("/accounts");
  revalidatePath("/analytics");
  revalidatePath("/");
}

// Internal helper, deliberately NOT ownership-guarded: it's also called
// server-to-server by app/api/investments/snapshot-balances (the 4h cron),
// which has no session to resolve a viewer from. Safe to leave open - every
// caller that acts on user input guards first (upsertHolding, deleteHolding,
// recordSale), and this function is a pure recompute: it derives an
// account's balance from that account's own holdings and writes nothing the
// caller controls, so invoking it against another account can neither
// disclose nor corrupt anything. Flagged for the security-audit phase all
// the same, since being exported from a "use server" module makes it
// directly invocable.
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
