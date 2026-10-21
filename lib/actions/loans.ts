"use server";

import { prisma } from "@/lib/db/prisma";
import { getViewer, assertAccountWritable } from "@/lib/auth-context";
import { revalidateAccount } from "@/lib/actions/revalidate";
import { actionError, actionOk, type ActionResult } from "@/lib/domain/action-result";
import { isBankReportedLoan } from "@/lib/domain/loan";
import { parseLoanTerms, type LoanTermsError } from "@/lib/domain/loan-terms";

/**
 * Edits a loan's contract terms (v2.19.2): what its bank never sends, or
 * gets wrong. Ownership is checked against the account itself - a Server
 * Action is reachable whatever the UI renders.
 *
 * On a bank-reported loan this never touches what is owed (liabilityCents)
 * or the next instalment: those are the bank's, refreshed every sync, and
 * the sync in turn never overwrites a term set here. On a manual loan the
 * amount borrowed is also its liabilityCents (the capital it was created
 * with), so the two move together.
 */
export async function updateLoanTerms(
  accountId: string,
  formData: FormData,
): Promise<ActionResult<void, LoanTermsError | "not_a_loan">> {
  const viewer = await getViewer();
  await assertAccountWritable(viewer.id, accountId);

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { type: true, syncId: true, gocardlessAccountId: true },
  });
  if (!account || account.type !== "LOAN") return actionError("not_a_loan");

  const field = (name: string) => formData.get(name) as string | null;
  const parsed = parseLoanTerms({
    amount: field("amount"),
    rate: field("rate"),
    startDate: field("startDate"),
    durationMonths: field("durationMonths"),
    deferralMonths: field("deferralMonths"),
    insurance: field("insurance"),
    endDate: field("endDate"),
    fundsOnAccounts: field("fundsOnAccounts"),
  });
  if (!parsed.ok) return actionError(parsed.error);

  const bankReported = isBankReportedLoan(account);
  await prisma.account.update({
    where: { id: accountId },
    data: {
      ...parsed.terms,
      ...(bankReported || parsed.terms.loanAmountCents === null ? {} : { liabilityCents: parsed.terms.loanAmountCents }),
    },
  });

  revalidateAccount(accountId);
  return actionOk();
}
