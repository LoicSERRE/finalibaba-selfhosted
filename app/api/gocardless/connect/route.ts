import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createRequisition } from "@/lib/services/gocardless";
import { getViewer } from "@/lib/auth-context";

export async function GET(req: NextRequest) {
  const institutionId = req.nextUrl.searchParams.get("institutionId");
  if (!institutionId) {
    return NextResponse.json({ error: "Missing institutionId" }, { status: 400 });
  }

  // institutionId is a plain query param, so this route has to check the
  // viewer owns it (v2.0) - otherwise anyone with a session could start a
  // bank-consent flow against another user's institution and, once the bank
  // redirected back, have its accounts imported under that user. The
  // callback derives attribution from the institution row rather than the
  // session precisely because it can arrive without one, which makes this
  // the only place the check can happen.
  const viewer = await getViewer();
  const institution = await prisma.institution.findUnique({ where: { id: institutionId } });
  if (!institution || institution.userId !== viewer.id) {
    return NextResponse.json({ error: "Institution not found" }, { status: 404 });
  }
  if (!institution.gocardlessInstitutionId) {
    return NextResponse.json({ error: "Institution not linked to GoCardless" }, { status: 400 });
  }

  const appUrl = process.env.APP_URL ?? `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  const redirectUrl = `${appUrl}/api/gocardless/callback`;

  // reference = our institution DB id → recovered in callback
  const requisition = await createRequisition(
    institution.gocardlessInstitutionId,
    institutionId,
    redirectUrl
  );

  await prisma.institution.update({
    where: { id: institutionId },
    data: { gocardlessRequisitionId: requisition.id },
  });

  return NextResponse.redirect(requisition.link);
}
