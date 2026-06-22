import { NextRequest, NextResponse } from "next/server";
import { searchInstitutions } from "@/lib/gocardless";

export async function GET(req: NextRequest) {
  const country = req.nextUrl.searchParams.get("country") ?? "FR";
  const search = req.nextUrl.searchParams.get("search") ?? undefined;

  if (!process.env.GOCARDLESS_SECRET_ID) {
    return NextResponse.json({ error: "GoCardless not configured" }, { status: 503 });
  }

  try {
    const institutions = await searchInstitutions(country, search || undefined);
    return NextResponse.json(institutions);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
