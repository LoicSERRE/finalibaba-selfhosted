import { NextRequest, NextResponse } from "next/server";
import { searchInstitutions } from "@/lib/services/gocardless";

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
    // Never forward the upstream error verbatim: lib/services/gocardless.ts
    // builds its messages from GoCardless's own response body (see the
    // `GoCardless auth failed (${res.status}): ${text}` throw there), so
    // String(e) hands an authenticated caller whatever that API chose to say
    // about this instance's credentials. Same rule the backup route already
    // follows for pg_dump/psql stderr - log the detail server-side, return a
    // generic message. Found by the post-v2.0 security audit; this route was
    // the one place the convention wasn't applied.
    console.error("GoCardless institution search failed:", e);
    return NextResponse.json({ error: "Bank search failed. Check server logs for details." }, { status: 500 });
  }
}
