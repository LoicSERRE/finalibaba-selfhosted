import { withAuth, type NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";

const authMiddleware = withAuth(
  function middleware(req) {
    // Demo mode - block all mutations (Server Actions use POST)
    if (process.env.DEMO_MODE === "true" && req.method !== "GET") {
      return new NextResponse(
        JSON.stringify({ error: "Mode démo - données en lecture seule." }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
  },
  {
    callbacks: {
      authorized: ({ token }) => {
        if (process.env.AUTH_ENABLED !== "true") return true;
        return !!token;
      },
    },
    pages: { signIn: "/login" },
  }
);

// next-auth's withAuth hard-codes a bypass for the sign-in page itself (to
// avoid a redirect loop) - it never redirects *away* from /login, even when
// auth is disabled. That leaves a stale bookmark/history entry from a time
// AUTH_ENABLED was on (or was briefly, wrongly, turned on - see the prod
// incident this was found from) stuck showing the password form forever,
// with no way back except manually navigating elsewhere. Handle that one
// case here as a real HTTP redirect, before withAuth ever sees the request -
// calling redirect() from the /login page itself instead hits a Next.js
// 16.2.11 client-router bug (React error #310, "rendered more hooks than
// during the previous render") when the redirect fires mid-stream.
export default function middleware(req: NextRequest, event: NextFetchEvent) {
  if (req.nextUrl.pathname === "/login" && process.env.AUTH_ENABLED !== "true") {
    return NextResponse.redirect(new URL("/", req.url));
  }
  return authMiddleware(req as NextRequestWithAuth, event);
}

export const config = {
  matcher: [
    // api/health is excluded alongside api/auth - docker-compose's healthcheck
    // hits this from inside the container and must never be blocked by
    // AUTH_ENABLED or redirected through /login.
    // shared is excluded for a different reason: app/shared/[token]/page.tsx
    // is a deliberately unauthenticated, token-gated route (a read-only share
    // link) that must work the same whether AUTH_ENABLED is on or off - the
    // token check inside the page is its own, independent gate. See
    // CLAUDE.md's "Read-only share links" section.
    // api/alerts is excluded for the same "no browser session on this call
    // path" reason as api/auth/api/health: sync/main.py calls
    // api/alerts/check directly, container-to-container, with no cookie to
    // present - it gates itself via a NEXTAUTH_SECRET bearer token instead.
    // See CLAUDE.md's "Alerts & webhooks" section.
    // NOSONAR (typescript:S7780) - this `config` export is statically parsed
    // by Next.js's middleware build step (extractExportedConstValue), which
    // requires a plain literal - a String.raw tagged-template expression here
    // isn't statically evaluable and makes the build fail with "Invalid
    // segment configuration export detected" (confirmed by testing it).
    "/((?!api/auth|api/health|api/alerts|shared|_next/static|_next/image|icon\\.svg|manifest\\.json|.*\\.(?:png|jpg|ico|webp)).*)", // NOSONAR
  ],
};
