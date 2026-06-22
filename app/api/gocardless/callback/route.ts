import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequisition, getAccountDetails, getAccountBalances, pickBalance, toAccountType } from "@/lib/gocardless";

export async function GET(req: NextRequest) {
  // GoCardless appends ?ref={reference} — we set reference = our institution DB id
  const institutionId = req.nextUrl.searchParams.get("ref");
  if (!institutionId) {
    return NextResponse.redirect(new URL("/settings?gc=error", req.url));
  }

  const institution = await prisma.institution.findUnique({ where: { id: institutionId } });
  if (!institution?.gocardlessRequisitionId) {
    return NextResponse.redirect(new URL("/settings?gc=error", req.url));
  }

  const requisition = await getRequisition(institution.gocardlessRequisitionId);

  // For each GoCardless account: upsert Account + record balance
  for (const gcAccountId of requisition.accounts) {
    const [{ account: details }, { balances }] = await Promise.all([
      getAccountDetails(gcAccountId),
      getAccountBalances(gcAccountId),
    ]);

    const name = details.name ?? details.product ?? details.iban ?? "Compte";
    const type = toAccountType(details.cashAccountType);
    const balanceCents = pickBalance(balances);

    const account = await prisma.account.upsert({
      where: { gocardlessAccountId: gcAccountId },
      update: { name, updatedAt: new Date() },
      create: {
        name,
        type,
        institutionId,
        gocardlessAccountId: gcAccountId,
      },
    });

    await prisma.historicalBalance.create({
      data: { accountId: account.id, balanceCents },
    });
  }

  return NextResponse.redirect(new URL("/banks?gc=connected", req.url));
}
