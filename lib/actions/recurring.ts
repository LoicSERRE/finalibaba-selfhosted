"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { RecurringFrequency } from "@/app/generated/prisma/enums";
import { parseCents } from "@/lib/utils/format";

const FREQUENCIES = new Set(Object.values(RecurringFrequency));

function revalidateAll() {
  revalidatePath("/recurring");
}

function parseSignedAmount(formData: FormData): bigint {
  const type = formData.get("type") as string | null;
  const raw = (formData.get("amount") as string | null) ?? "";
  const cents = parseCents(raw);
  if (cents <= BigInt(0)) throw new Error("Amount must be positive");
  return type === "income" ? cents : -cents;
}

function parseFrequency(formData: FormData): RecurringFrequency {
  const frequency = formData.get("frequency") as string | null;
  if (!frequency || !FREQUENCIES.has(frequency as RecurringFrequency)) throw new Error("Invalid frequency");
  return frequency as RecurringFrequency;
}

function parseAnchorDate(formData: FormData): Date {
  const raw = formData.get("anchorDate") as string | null;
  if (!raw) throw new Error("Anchor date required");
  // Noon UTC - same convention as importTransactions/importBalanceHistory,
  // so anchorDate lines up day-for-day against real Transaction.date values.
  return new Date(`${raw}T12:00:00.000Z`);
}

export async function createRecurringTransaction(formData: FormData) {
  const label = (formData.get("label") as string).trim();
  if (!label) throw new Error("Label required");

  const accountId = formData.get("accountId") as string | null;
  if (!accountId) throw new Error("Account required");

  const amountCents = parseSignedAmount(formData);
  const frequency = parseFrequency(formData);
  const intervalCount = Math.max(1, parseInt((formData.get("intervalCount") as string) || "1", 10) || 1);
  const anchorDate = parseAnchorDate(formData);
  const categoryId = (formData.get("categoryId") as string | null)?.trim() || null;
  const autoDetected = formData.get("autoDetected") === "true";

  await prisma.recurringTransaction.create({
    data: { accountId, label, amountCents, categoryId, frequency, intervalCount, anchorDate, autoDetected },
  });
  revalidateAll();
}

export async function updateRecurringTransaction(id: string, formData: FormData) {
  const label = (formData.get("label") as string).trim();
  if (!label) throw new Error("Label required");

  const accountId = formData.get("accountId") as string | null;
  if (!accountId) throw new Error("Account required");

  const amountCents = parseSignedAmount(formData);
  const frequency = parseFrequency(formData);
  const intervalCount = Math.max(1, parseInt((formData.get("intervalCount") as string) || "1", 10) || 1);
  const anchorDate = parseAnchorDate(formData);
  const categoryId = (formData.get("categoryId") as string | null)?.trim() || null;

  await prisma.recurringTransaction.update({
    where: { id },
    data: { accountId, label, amountCents, categoryId, frequency, intervalCount, anchorDate },
  });
  revalidateAll();
}

export async function deleteRecurringTransaction(id: string) {
  await prisma.recurringTransaction.delete({ where: { id } });
  revalidateAll();
}

export async function dismissSuggestion(candidate: {
  accountId: string;
  label: string;
  amountCents: number;
  frequency: RecurringFrequency;
  anchorDate: string; // ISO date, YYYY-MM-DD
}) {
  await prisma.recurringTransaction.create({
    data: {
      accountId: candidate.accountId,
      label: candidate.label,
      amountCents: BigInt(candidate.amountCents),
      frequency: candidate.frequency,
      anchorDate: new Date(`${candidate.anchorDate}T12:00:00.000Z`),
      active: false,
      autoDetected: true,
    },
  });
  revalidateAll();
}

export async function toggleRecurringActive(id: string, active: boolean) {
  await prisma.recurringTransaction.update({ where: { id }, data: { active } });
  revalidateAll();
}
