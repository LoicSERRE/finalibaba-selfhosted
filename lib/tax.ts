import { TaxTreatment } from "@/app/generated/prisma/enums";

/**
 * The latent-tax rate to apply to an account's unrealized gain, or null if
 * unknown (TAXABLE with no rate set - shouldn't happen via the UI, but the
 * type allows it since taxRatePct is nullable in the DB).
 */
export function getAccountTaxRate(account: { taxTreatment: TaxTreatment; taxRatePct: number | null }): number | null {
  if (account.taxTreatment !== "TAXABLE") return 0;
  return account.taxRatePct;
}
