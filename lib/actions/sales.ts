"use server";

import { revalidateSale } from "@/lib/actions/revalidate";
import { prisma } from "@/lib/db/prisma";
import { getViewer, assertAccountWritable } from "@/lib/auth-context";
import { parseCents } from "@/lib/utils/format";
import Decimal from "decimal.js";
import { refreshAccountBalance } from "@/lib/actions/holdings";

function revalidateAll(accountId: string) {
  revalidateSale(accountId);
}

export async function recordSale(formData: FormData) {
  const accountId = formData.get("accountId") as string;
  const viewer = await getViewer();
  await assertAccountWritable(viewer.id, accountId);
  const ticker = (formData.get("ticker") as string).trim().toUpperCase();
  const quantitySold = new Decimal(formData.get("quantitySold") as string);
  const proceedsCents = parseCents(formData.get("proceeds") as string);
  const costBasisCents = parseCents(formData.get("costBasis") as string);
  const dateStr = (formData.get("date") as string | null)?.trim();
  // Noon UTC - same convention as Transaction.date/IncomeEvent.date.
  const date = dateStr ? new Date(`${dateStr}T12:00:00.000Z`) : new Date();

  if (quantitySold.lte(0)) throw new Error("Quantity must be positive");
  if (costBasisCents < BigInt(0)) throw new Error("Cost basis cannot be negative");

  const holding = await prisma.holding.findUnique({
    where: { accountId_ticker: { accountId, ticker } },
  });
  if (!holding) throw new Error("Holding not found");

  const holdingQuantity = new Decimal(holding.quantity.toString());
  if (quantitySold.gt(holdingQuantity)) throw new Error("Cannot sell more than the current position");
  // The sold portion's cost basis can never exceed what's left on the position -
  // otherwise the remaining Holding.costBasisCents goes negative and corrupts
  // every future gain/tax display for it.
  if (holding.costBasisCents != null && costBasisCents > holding.costBasisCents) {
    throw new Error("Cost basis for the sold portion cannot exceed the position's remaining cost basis");
  }

  await prisma.$transaction(async (tx) => {
    await tx.sale.create({
      data: { accountId, ticker, quantity: quantitySold, proceedsCents, costBasisCents, date },
    });

    if (quantitySold.gte(holdingQuantity)) {
      // Full disposal - nothing left of the position.
      await tx.holding.delete({ where: { id: holding.id } });
    } else {
      // Partial disposal - reduce quantity and cost basis proportionally,
      // keeping the remaining position's average cost basis correct.
      const remainingQuantity = holdingQuantity.minus(quantitySold);
      const remainingCostBasisCents =
        holding.costBasisCents != null ? holding.costBasisCents - costBasisCents : null;
      await tx.holding.update({
        where: { id: holding.id },
        data: { quantity: remainingQuantity, costBasisCents: remainingCostBasisCents },
      });
    }
  });

  await refreshAccountBalance(accountId);
  revalidateAll(accountId);
}

// Record-only deletion - does not reverse the Holding's quantity/cost-basis
// change, since the holding may have had further buys/sells/price updates
// since (this app deliberately doesn't keep per-lot history to reconstruct
// that). Correcting a mistaken sale means deleting it here *and* manually
// fixing the Holding via the existing edit dialog.
export async function deleteSale(id: string) {
  const sale = await prisma.sale.findUnique({ where: { id }, select: { accountId: true } });
  if (!sale) throw new Error("Vente introuvable.");
  const viewer = await getViewer();
  await assertAccountWritable(viewer.id, sale.accountId);
  await prisma.sale.delete({ where: { id } });
  revalidateAll(sale.accountId);
}
