import { NextResponse } from "next/server";

const SUPPORTED = new Set(["dark", "light", "auto"]);

export async function GET(request: Request) {
  const theme = new URL(request.url).searchParams.get("theme") ?? "";
  if (!SUPPORTED.has(theme)) {
    return NextResponse.json({ error: "Invalid theme" }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("THEME", theme, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return res;
}
