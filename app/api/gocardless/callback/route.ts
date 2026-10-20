import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getRequisition, getAccountDetails, getAccountBalances, pickBalance, pickBalanceCurrency, toAccountType } from "@/lib/services/gocardless";
import { balanceColumns } from "@/lib/domain/currency";
import { rateToEurOn } from "@/lib/services/exchange-rate";
import { resolveSyncedAccountCurrency } from "@/lib/services/account-currency";
import { settingsTabHref } from "@/lib/domain/settings-tabs";

export async function GET(req: NextRequest) {
  // GoCardless appends ?ref={reference} - we set reference = our institution DB id
  const institutionId = req.nextUrl.searchParams.get("ref");
  if (!institutionId) {
    return NextResponse.redirect(new URL(settingsTabHref("accounts", { gc: "error" }), req.url));
  }

  const institution = await prisma.institution.findUnique({ where: { id: institutionId } });
  if (!institution?.gocardlessRequisitionId) {
    return NextResponse.redirect(new URL(settingsTabHref("accounts", { gc: "error" }), req.url));
  }

  // Attribution comes from the institution row, never from whoever's session
  // happens to hit this URL (v2.0): this is a redirect back from the bank's
  // own consent page, so it can legitimately arrive with no session cookie at
  // all, and `?ref=` is caller-influenceable either way. Deriving the owner
  // from the institution means the imported accounts always land on whoever
  // configured the connection, which is also what makes the ownership check
  // in the loop below meaningful.
  const ownerUserId = institution.userId;

  const requisition = await getRequisition(institution.gocardlessRequisitionId);

  // For each GoCardless account: upsert Account + record balance
  let conflicted = 0;
  for (const gcAccountId of requisition.accounts) {
    // H7: Account.gocardlessAccountId is globally unique, so two users
    // connecting the SAME physical bank account collide here. Without this
    // check the upsert would silently rewrite the first user's account row
    // and append a balance snapshot to it - a cross-user write triggered by
    // a completely legitimate action. Skipping and reporting it back keeps
    // the first connection intact; co-ownership (Settings -> account sharing)
    // is the supported way for two people to both see a joint account.
    const existing = await prisma.account.findUnique({
      where: { gocardlessAccountId: gcAccountId },
      select: { id: true, userId: true },
    });
    if (existing && existing.userId !== ownerUserId) {
      conflicted += 1;
      continue;
    }

    const [{ account: details }, { balances }] = await Promise.all([
      getAccountDetails(gcAccountId),
      getAccountBalances(gcAccountId),
    ]);

    const name = details.name ?? details.product ?? details.iban ?? "Compte";
    const type = toAccountType(details.cashAccountType);

    const account = await prisma.account.upsert({
      where: { gocardlessAccountId: gcAccountId },
      update: { name, updatedAt: new Date() },
      create: {
        userId: ownerUserId,
        name,
        type,
        institutionId,
        gocardlessAccountId: gcAccountId,
      },
    });

    // The account's own currency (v2.18): the details' if the bank gives
    // one, else the balance's. A new account starts EUR and takes it here;
    // a rate that cannot be fetched only delays the first balance to the
    // next sync, it never stores a guess.
    const currency = await resolveSyncedAccountCurrency(account.id, details.currency ?? pickBalanceCurrency(balances));
    const rate = currency === null ? null : await rateToEurOn(currency);
    if (currency !== null && rate !== null) {
      await prisma.historicalBalance.create({
        data: { accountId: account.id, ...balanceColumns(currency, pickBalance(balances), rate) },
      });
    }
  }

  if (conflicted > 0) {
    return NextResponse.redirect(new URL(settingsTabHref("accounts", { gc: "already-connected" }), req.url));
  }
  return NextResponse.redirect(new URL(settingsTabHref("accounts", { gc: "connected" }), req.url));
}
