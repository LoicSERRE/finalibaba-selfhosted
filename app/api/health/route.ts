import { NextResponse } from "next/server";

// Liveness only (mirrors sync/main.py's GET /health) - no DB query, so this
// stays fast and can't itself become the thing that takes the container down
// under DB load. docker-compose's healthcheck just needs to know the Next.js
// process is up and serving requests.
export async function GET() {
  return NextResponse.json({ ok: true });
}
