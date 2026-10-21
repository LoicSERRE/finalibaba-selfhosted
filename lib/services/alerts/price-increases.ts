/**
 * The price-increase alert (v2.20): a recurring expense charged dearer than
 * its template. Once per new price - priceAlertedCents remembers the one
 * already announced - and silent once the user updates the template, since
 * the charge then matches it.
 */
import { prisma } from "@/lib/db/prisma";
import type { UserSettingsModel } from "@/app/generated/prisma/models";
import { dispatchAlert } from "@/lib/services/notifications";
import { findPriceIncreases } from "@/lib/services/recurring-price-changes";
import { baseSymbol } from "@/lib/utils/base-currency";

const euros = (cents: bigint) =>
  (Math.abs(Number(cents)) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function checkPriceIncreaseAlerts(settings: UserSettingsModel, accountIds: string[]): Promise<string[]> {
  if (!settings.priceIncreaseAlertsEnabled) return [];
  const fired: string[] = [];
  for (const row of await findPriceIncreases(accountIds, new Date())) {
    const { fromCents, toCents, yearlyExtraCents } = row.increase;
    if (row.priceAlertedCents === toCents) continue;
    await dispatchAlert(
      settings,
      `Hausse de prix : ${row.label}`,
      `« ${row.label} » est passé de ${euros(fromCents)} ${baseSymbol()} à ${euros(toCents)} ${baseSymbol()} (+${euros(yearlyExtraCents)} ${baseSymbol()} par an).`
    );
    await prisma.recurringTransaction.update({ where: { id: row.id }, data: { priceAlertedCents: toCents } });
    fired.push(row.id);
  }
  return fired;
}
