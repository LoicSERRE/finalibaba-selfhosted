"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { IncomeType } from "@/app/generated/prisma/enums";
import { parseCents } from "@/lib/utils/format";

const INCOME_TYPES = new Set(Object.values(IncomeType));

// Mirrors the DIVIDEND_ACCOUNT_TYPES/INTEREST_ACCOUNT_TYPES filter in
// add-income-dialog.tsx. That filter only controls what's selectable in the
// UI - Server Actions are reachable directly regardless of what's on screen,
// so the same rule must be enforced here too before writing anything.
const ELIGIBLE_ACCOUNT_TYPES: Record<IncomeType, Set<string>> = {
  DIVIDEND: new Set(["INVESTMENT", "CRYPTO"]),
  INTEREST: new Set(["CHECKING", "SAVINGS"]),
};

async function assertIncomeEventEligible(accountId: string, type: IncomeType): Promise<void> {
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { type: true } });
  if (!account) throw new Error("Account not found.");
  if (!ELIGIBLE_ACCOUNT_TYPES[type].has(account.type)) {
    throw new Error(
      type === "DIVIDEND"
        ? "Dividends can only be recorded on investment/crypto accounts."
        : "Interest can only be recorded on checking/savings accounts."
    );
  }
}

function revalidateAll() {
  revalidatePath("/income");
  revalidatePath("/analytics");
}

function parseIncomeType(formData: FormData): IncomeType {
  const type = formData.get("type") as string | null;
  if (!type || !INCOME_TYPES.has(type as IncomeType)) throw new Error("Invalid type");
  return type as IncomeType;
}

function parseGrossAmount(formData: FormData): bigint {
  const raw = (formData.get("amount") as string | null) ?? "";
  const cents = parseCents(raw);
  if (cents <= BigInt(0)) throw new Error("Amount must be positive");
  return cents;
}

function parseOptionalTaxWithheld(formData: FormData, grossCents: bigint): bigint | undefined {
  const raw = formData.get("taxWithheld") as string | null;
  if (!raw || raw.trim() === "") return undefined;
  const cents = parseCents(raw);
  if (cents <= BigInt(0)) return undefined;
  if (cents >= grossCents) throw new Error("Tax withheld cannot exceed the gross amount");
  return cents;
}

function parseDate(formData: FormData): Date {
  const raw = formData.get("date") as string | null;
  if (!raw) throw new Error("Date required");
  // Noon UTC - same convention as Transaction.date/RecurringTransaction.anchorDate.
  return new Date(`${raw}T12:00:00.000Z`);
}

export async function createIncomeEvent(formData: FormData) {
  const accountId = formData.get("accountId") as string | null;
  if (!accountId) throw new Error("Account required");

  const type = parseIncomeType(formData);
  await assertIncomeEventEligible(accountId, type);
  const amountCents = parseGrossAmount(formData);
  const taxWithheldCents = parseOptionalTaxWithheld(formData, amountCents);
  const date = parseDate(formData);
  const ticker = (formData.get("ticker") as string | null)?.trim().toUpperCase() || null;

  await prisma.incomeEvent.create({
    data: { accountId, type, amountCents, taxWithheldCents, date, ticker },
  });
  revalidateAll();
}

export async function updateIncomeEvent(id: string, formData: FormData) {
  const accountId = formData.get("accountId") as string | null;
  if (!accountId) throw new Error("Account required");

  const type = parseIncomeType(formData);
  await assertIncomeEventEligible(accountId, type);
  const amountCents = parseGrossAmount(formData);
  const taxWithheldCents = parseOptionalTaxWithheld(formData, amountCents);
  const date = parseDate(formData);
  const ticker = (formData.get("ticker") as string | null)?.trim().toUpperCase() || null;

  await prisma.incomeEvent.update({
    where: { id },
    data: { accountId, type, amountCents, taxWithheldCents: taxWithheldCents ?? null, date, ticker },
  });
  revalidateAll();
}

export async function deleteIncomeEvent(id: string) {
  await prisma.incomeEvent.delete({ where: { id } });
  revalidateAll();
}
