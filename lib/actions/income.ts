"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { IncomeType } from "@/app/generated/prisma/enums";
import { parseCents } from "@/lib/utils/format";
import { normalizeLabelForCategorization, isGenericTransferLabel } from "@/lib/domain/auto-categorize";

const INCOME_TYPES = new Set(Object.values(IncomeType));

// Mirrors the DIVIDEND_ACCOUNT_TYPES/INTEREST_ACCOUNT_TYPES filter in
// add-income-dialog.tsx. That filter only controls what's selectable in the
// UI - Server Actions are reachable directly regardless of what's on screen,
// so the same rule must be enforced here too before writing anything.
// DIVIDEND also allows CHECKING (not just INVESTMENT/CRYPTO): Trade
// Republic's timeline sync writes every money-movement event - trades,
// dividends, interest, card payments - onto one shared CHECKING-typed
// "Compte espèces" account (see "Trade Republic transaction history" in
// CLAUDE.md), so a real dividend payout can legitimately land on a
// CHECKING account, not just a dedicated investment account.
const ELIGIBLE_ACCOUNT_TYPES: Record<IncomeType, Set<string>> = {
  DIVIDEND: new Set(["INVESTMENT", "CRYPTO", "CHECKING"]),
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

// "Mark as income" - creates an IncomeEvent directly from an existing
// Transaction (amount + date pre-filled from it, linked via
// transactionId) instead of the user retyping everything by hand on
// /income. `type` still comes from the caller rather than being inferred
// from the account alone: CHECKING/SAVINGS accounts are usually
// unambiguous (interest), but Trade Republic's combined cash account can
// hold both real dividend payouts and card payments (see the
// ELIGIBLE_ACCOUNT_TYPES comment above) - assertIncomeEventEligible below
// still rejects a mismatched type/account pair either way.
export async function createIncomeEventFromTransaction(
  transactionId: string,
  formData: FormData
): Promise<{ siblingCount: number }> {
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { id: true, accountId: true, date: true, amountCents: true, label: true, incomeEvent: { select: { id: true } } },
  });
  if (!transaction) throw new Error("Transaction not found.");
  if (transaction.incomeEvent) throw new Error("This transaction is already recorded as income.");
  if (transaction.amountCents <= BigInt(0)) throw new Error("Only a credit can be recorded as income.");

  const type = parseIncomeType(formData);
  await assertIncomeEventEligible(transaction.accountId, type);
  const taxWithheldCents = parseOptionalTaxWithheld(formData, transaction.amountCents);
  const ticker = (formData.get("ticker") as string | null)?.trim().toUpperCase() || null;

  await prisma.incomeEvent.create({
    data: {
      accountId: transaction.accountId,
      transactionId: transaction.id,
      type,
      amountCents: transaction.amountCents,
      taxWithheldCents,
      date: transaction.date,
      ticker,
    },
  });

  revalidateAll();
  revalidatePath(`/accounts/${transaction.accountId}`);

  // Same reasoning as setTransactionCategory's siblingCount in
  // lib/actions/transactions.ts: how many other not-yet-linked, credit
  // transactions in this account share the same
  // normalizeLabelForCategorization label (year-suffix included), so the
  // UI can offer to mark them as income too in one click rather than
  // requiring this to be repeated for every occurrence. Never offered for
  // a generic transfer label ("VIREMENT SEPA" and friends) - same reason
  // as that function: a French bank reuses this boilerplate for both real
  // internal transfers and real external payments, so treating every
  // same-labeled transaction as "also income" would be just as wrong here
  // as it was for categorization.
  let siblingCount = 0;
  if (!isGenericTransferLabel(transaction.label)) {
    const normalized = normalizeLabelForCategorization(transaction.label);
    const candidates = await prisma.transaction.findMany({
      where: { accountId: transaction.accountId, id: { not: transactionId }, amountCents: { gt: BigInt(0) }, incomeEvent: null },
      select: { label: true },
    });
    siblingCount = candidates.filter((c) => normalizeLabelForCategorization(c.label) === normalized).length;
  }

  return { siblingCount };
}

// Propagates "mark as income" to every other not-yet-linked, credit
// transaction in the same account sharing the same
// normalizeLabelForCategorization label as the one just marked - fixes the
// same practical problem applyCategoryToSimilarTransactions
// (lib/actions/transactions.ts) solves for categorization: a once-a-year
// interest credit or a recurring dividend shouldn't need this done by hand
// for every single occurrence. Unlike that function, this one *skips*
// already-linked transactions rather than overwriting them - marking a
// transaction as income creates a new fiscal record, it doesn't correct an
// existing one, so an already-marked sibling is left untouched instead of
// being double-recorded.
export async function markSimilarTransactionsAsIncome(
  transactionId: string,
  formData: FormData
): Promise<{ created: number }> {
  const source = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { accountId: true, label: true },
  });
  if (!source) return { created: 0 };
  if (isGenericTransferLabel(source.label)) return { created: 0 };

  const type = parseIncomeType(formData);
  await assertIncomeEventEligible(source.accountId, type);
  const ticker = (formData.get("ticker") as string | null)?.trim().toUpperCase() || null;

  const normalized = normalizeLabelForCategorization(source.label);
  const candidates = await prisma.transaction.findMany({
    where: { accountId: source.accountId, id: { not: transactionId }, amountCents: { gt: BigInt(0) }, incomeEvent: null },
    select: { id: true, label: true, date: true, amountCents: true },
  });
  const matches = candidates.filter((c) => normalizeLabelForCategorization(c.label) === normalized);
  if (matches.length === 0) return { created: 0 };

  await prisma.incomeEvent.createMany({
    data: matches.map((m) => ({
      accountId: source.accountId,
      transactionId: m.id,
      type,
      amountCents: m.amountCents,
      date: m.date,
      ticker,
    })),
  });

  revalidateAll();
  revalidatePath(`/accounts/${source.accountId}`);

  return { created: matches.length };
}
