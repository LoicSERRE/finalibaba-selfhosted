"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { AccountType, TaxTreatment } from "@/app/generated/prisma/enums";
import { parseCents } from "@/lib/utils/format";

const TAX_TREATMENTS = new Set(Object.values(TaxTreatment));

function parseTaxTreatment(formData: FormData): TaxTreatment {
  const raw = formData.get("taxTreatment") as string | null;
  return raw && TAX_TREATMENTS.has(raw as TaxTreatment) ? (raw as TaxTreatment) : "TAXABLE";
}

// Percent input (0-100) -> ratio (0-1), same convention as UserSettings.taxRateX.
function parseTaxRatePct(val: FormDataEntryValue | null): number | undefined {
  if (!val || (val as string).trim() === "") return undefined;
  const n = parseFloat(val as string);
  return isNaN(n) ? undefined : Math.min(1, Math.max(0, n / 100));
}

const MANUAL_VALUE_TYPES = ["REAL_ESTATE", "AUTOMOBILE"] as const;
type ManualType = (typeof MANUAL_VALUE_TYPES)[number];

function isManualType(type: string): type is ManualType {
  return MANUAL_VALUE_TYPES.includes(type as ManualType);
}

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath("/analytics");
}

function parseOptionalCents(val: FormDataEntryValue | null): bigint | undefined {
  if (!val || (val as string).trim() === "") return undefined;
  const cents = parseCents(val as string);
  return cents > BigInt(0) ? cents : undefined;
}

function parseOptionalFloat(val: FormDataEntryValue | null): number | undefined {
  if (!val || (val as string).trim() === "") return undefined;
  const n = parseFloat(val as string);
  return isNaN(n) ? undefined : n;
}

function parseOptionalInt(val: FormDataEntryValue | null): number | undefined {
  if (!val || (val as string).trim() === "") return undefined;
  const n = parseInt(val as string, 10);
  return isNaN(n) ? undefined : n;
}

// One Server Action handling every account type's own required/optional
// fields (fiat/investment/real estate/automobile/loan) - the branching is
// inherent to the generic "Add account" form covering all of them at once.
// eslint-disable-next-line sonarjs/cognitive-complexity
export async function createAccount(formData: FormData) {
  const name = (formData.get("name") as string).trim();
  const type = formData.get("type") as AccountType;
  const rawInstitutionId = (formData.get("institutionId") as string | null)?.trim();
  const institutionId = rawInstitutionId || undefined; // empty string → undefined (null in DB)

  const initialBalanceStr = formData.get("initialBalance") as string | null;
  const liabilityStr = formData.get("liability") as string | null;
  const investmentSubtype = (formData.get("investmentSubtype") as string | null) || null;
  const purchasePriceStr = formData.get("purchasePrice") as string | null;
  const taxTreatment = parseTaxTreatment(formData);
  const taxRatePct = parseTaxRatePct(formData.get("taxRatePct"));

  const balanceCents = initialBalanceStr ? parseCents(initialBalanceStr) : null;
  const liabilityCents = liabilityStr ? parseCents(liabilityStr) : null;
  const purchasePriceCents = purchasePriceStr ? parseCents(purchasePriceStr) : null;

  // LOAN-specific fields
  const insuranceMonthlyCents = parseOptionalCents(formData.get("insuranceMonthly"));
  const loanAmountCents = parseOptionalCents(formData.get("loanAmount"));
  const loanTaeg = parseOptionalFloat(formData.get("loanTaeg"));
  const loanDurationMonths = parseOptionalInt(formData.get("loanDurationMonths"));
  const loanDeferralMonths = parseOptionalInt(formData.get("loanDeferralMonths")) ?? 0;
  const loanStartDateStr = (formData.get("loanStartDate") as string | null)?.trim();
  const loanStartDate = loanStartDateStr ? new Date(loanStartDateStr) : undefined;

  const isLoan = type === "LOAN";
  const isInvestment = type === "INVESTMENT" || type === "CRYPTO";

  const account = await prisma.account.create({
    data: {
      name,
      type,
      institutionId,
      manualValueCents: isManualType(type) ? (balanceCents ?? undefined) : undefined,
      liabilityCents: isManualType(type)
        ? (liabilityCents ?? undefined)
        : isLoan
        ? loanAmountCents  // initial capital = liability for loan accounts
        : undefined,
      purchasePriceCents: type === "AUTOMOBILE" ? (purchasePriceCents ?? undefined) : undefined,
      insuranceMonthlyCents: (type === "AUTOMOBILE" || isLoan) ? insuranceMonthlyCents : undefined,
      investmentSubtype: type === "INVESTMENT" ? investmentSubtype : undefined,
      taxTreatment: isInvestment ? taxTreatment : undefined,
      taxRatePct: isInvestment && taxTreatment === "TAXABLE" ? (taxRatePct ?? null) : null,
      loanAmountCents: isLoan ? loanAmountCents : undefined,
      loanTaeg: isLoan ? loanTaeg : undefined,
      loanDurationMonths: isLoan ? loanDurationMonths : undefined,
      loanDeferralMonths: isLoan ? loanDeferralMonths : undefined,
      loanStartDate: isLoan ? loanStartDate : undefined,
    },
  });

  // Record initial balance snapshot (fiat accounts only)
  if (
    balanceCents &&
    balanceCents > BigInt(0) &&
    type !== "INVESTMENT" &&
    type !== "CRYPTO" &&
    !isManualType(type) &&
    !isLoan
  ) {
    await prisma.historicalBalance.create({
      data: { accountId: account.id, balanceCents },
    });
  }

  // For loans: seed a zero balance snapshot so the account appears in the history tracker
  // (liabilityCents is subtracted from net worth charts separately).
  if (isLoan) {
    await prisma.historicalBalance.create({
      data: { accountId: account.id, balanceCents: BigInt(0) },
    });
  }

  revalidateAll();
}

export async function deleteAccount(id: string) {
  await prisma.account.delete({ where: { id } });
  revalidateAll();
}

export async function updateRealEstateAccount(formData: FormData) {
  const id = formData.get("id") as string;
  const valueCents = parseCents(formData.get("value") as string);
  const liabilityCents = parseCents(formData.get("liability") as string);

  await prisma.account.update({
    where: { id },
    data: { manualValueCents: valueCents, liabilityCents },
  });

  await prisma.historicalBalance.create({
    data: { accountId: id, balanceCents: valueCents },
  });

  revalidateAll();
}

export async function updateInvestmentStartDate(formData: FormData) {
  const id = formData.get("id") as string;
  const dateStr = (formData.get("investmentStartDate") as string | null)?.trim();
  const investmentStartDate = dateStr ? new Date(dateStr) : null;

  await prisma.account.update({
    where: { id },
    data: { investmentStartDate },
  });

  revalidatePath(`/accounts/${id}`);
  revalidatePath("/analytics");
}

export async function updateAccountTaxTreatment(formData: FormData) {
  const id = formData.get("id") as string;
  const taxTreatment = parseTaxTreatment(formData);
  const taxRatePct = parseTaxRatePct(formData.get("taxRatePct"));

  await prisma.account.update({
    where: { id },
    data: {
      taxTreatment,
      taxRatePct: taxTreatment === "TAXABLE" ? (taxRatePct ?? null) : null,
    },
  });

  revalidatePath(`/accounts/${id}`);
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath("/analytics");
}

export async function updateAutomobileAccount(formData: FormData) {
  const id = formData.get("id") as string;
  const valueCents = parseCents(formData.get("value") as string);
  const liabilityCents = parseCents(formData.get("liability") as string);
  const insuranceMonthlyCents = parseOptionalCents(formData.get("insuranceMonthly"));

  await prisma.account.update({
    where: { id },
    data: {
      manualValueCents: valueCents,
      liabilityCents,
      insuranceMonthlyCents,
    },
  });

  await prisma.historicalBalance.create({
    data: { accountId: id, balanceCents: valueCents },
  });

  revalidateAll();
}
