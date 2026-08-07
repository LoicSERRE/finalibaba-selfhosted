import { NextResponse } from "next/server";

const SUPPORTED = new Set(["en", "fr"]);

export async function GET(request: Request) {
  const locale = new URL(request.url).searchParams.get("locale") ?? "";
  if (!SUPPORTED.has(locale)) {
    return NextResponse.json({ error: "Invalid locale" }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("NEXT_LOCALE", locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return res;
}
