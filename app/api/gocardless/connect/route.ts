import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createRequisition } from "@/lib/gocardless";

export async function GET(req: NextRequest) {
  const institutionId = req.nextUrl.searchParams.get("institutionId");
  if (!institutionId) {
    return NextResponse.json({ error: "Missing institutionId" }, { status: 400 });
  }

  const institution = await prisma.institution.findUnique({ where: { id: institutionId } });
  if (!institution?.gocardlessInstitutionId) {
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
