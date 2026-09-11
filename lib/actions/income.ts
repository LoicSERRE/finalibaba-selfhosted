"use server";

import { revalidateIncome } from "@/lib/actions/revalidate";
import { prisma } from "@/lib/db/prisma";
import { getViewer, assertAccountWritable } from "@/lib/auth-context";
import { IncomeType } from "@/app/generated/prisma/enums";
import { parseCents } from "@/lib/utils/format";
import { normalizeLabelForCategorization, isGenericTransferLabel } from "@/lib/domain/auto-categorize";
import { excludeInternalTransfers } from "@/lib/domain/transaction-filters";

const INCOME_TYPES = new Set(Object.values(IncomeType));

// The dialog's own filter controls what is SELECTABLE; a Server Action is
// reachable whatever the UI renders, so the rule is enforced here too.
// DIVIDEND allows CHECKING because Trade Republic writes every event -
// trades, dividends, card payments - onto one shared cash account.
const ELIGIBLE_ACCOUNT_TYPES: Record<IncomeType, Set<string>> = {
  DIVIDEND: new Set(["INVESTMENT", "CRYPTO", "CHECKING"]),
  INTEREST: new Set(["CHECKING", "SAVINGS"]),
};

// Ownership is checked here too, not just account-type eligibility: this is
// the chokepoint every income-writing action already goes through, so the
// two rules stay together instead of each call site remembering both.
async function assertIncomeEventEligible(accountId: string, type: IncomeType): Promise<void> {
  const viewer = await getViewer();
  await assertAccountWritable(viewer.id, accountId);

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
  revalidateIncome(accountId);
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
  revalidateIncome(accountId);
}

export async function deleteIncomeEvent(id: string) {
  // The only income action that doesn't route through
  // assertIncomeEventEligible (there's no account/type pair to validate),
  // so it carries its own ownership check.
  const event = await prisma.incomeEvent.findUnique({ where: { id }, select: { accountId: true } });
  if (!event) throw new Error("Not found.");
  const viewer = await getViewer();
  await assertAccountWritable(viewer.id, event.accountId);

  await prisma.incomeEvent.delete({ where: { id } });
  revalidateIncome(event.accountId);
}

// Creates an IncomeEvent from an existing Transaction rather than making the
// user retype it. `type` comes from the caller, not inferred from the account:
// a combined cash account holds both dividends and card payments.
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

  revalidateIncome(transaction.accountId);

  // Other unlinked credits sharing the same normalised label, so the UI can
  // offer to mark them too rather than repeating this per occurrence.
  //
  // Excludes internal transfers by the FLAG, not the label: the denylist knows
  // only two boilerplate wordings, so a transfer arriving with a real name
  // attached sailed through it and was recorded as a dividend - in the one
  // place meant to be accurate enough to declare.
  let siblingCount = 0;
  if (!isGenericTransferLabel(transaction.label)) {
    const normalized = normalizeLabelForCategorization(transaction.label);
    const candidates = await prisma.transaction.findMany({
      where: excludeInternalTransfers({
        accountId: transaction.accountId,
        id: { not: transactionId },
        amountCents: { gt: BigInt(0) },
        incomeEvent: null,
      }),
      select: { label: true },
    });
    siblingCount = candidates.filter((c) => normalizeLabelForCategorization(c.label) === normalized).length;
  }

  return { siblingCount };
}

// Propagates to every other unlinked credit with the same label, so a
// once-a-year interest credit is not marked by hand every year. SKIPS
// already-linked rows rather than overwriting: this creates a fiscal record,
// it does not correct one, so an already-marked sibling must not double up.
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
  // Same exclusion, and the same reason, as the sibling count that offered
  // this in the first place - see createIncomeEventFromTransaction. The two
  // queries have to agree or the confirmation would promise one number and
  // write another.
  const candidates = await prisma.transaction.findMany({
    where: excludeInternalTransfers({
      accountId: source.accountId,
      id: { not: transactionId },
      amountCents: { gt: BigInt(0) },
      incomeEvent: null,
    }),
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

  revalidateIncome(source.accountId);

  return { created: matches.length };
}
