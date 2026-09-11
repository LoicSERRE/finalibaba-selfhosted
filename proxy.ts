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

// withAuth never redirects AWAY from /login, so a stale bookmark from a time
// AUTH_ENABLED was on shows the password form forever. Handled here rather
// than in the page: redirect() from /login itself trips a Next client-router
// bug (React #310) when it fires mid-stream.
export default function middleware(req: NextRequest, event: NextFetchEvent) {
  if (req.nextUrl.pathname === "/login" && process.env.AUTH_ENABLED !== "true") {
    return NextResponse.redirect(new URL("/", req.url));
  }
  return authMiddleware(req as NextRequestWithAuth, event);
}

export const config = {
  matcher: [
    // Everything excluded here is either a route with its own gate or a route
    // no browser session ever reaches. Three groups:
    //
    //   - token-gated pages that must work with auth on or off: `shared`,
    //     `invite` (without it an AUTH_ENABLED instance sends every invitee to
    //     a login page they cannot get past, so the flow is unreachable)
    //   - container-to-container callers with no cookie, each gated by a
    //     NEXTAUTH_SECRET bearer token: api/alerts, api/transactions,
    //     api/investments, api/realtime/notify, plus api/health for the
    //     compose healthcheck. api/realtime/STREAM is deliberately absent -
    //     the browser opens it and it needs the session
    //   - generated assets with no file extension for the `.png|jpg|...`
    //     branch to catch: the icon routes, site.webmanifest, sw.js
    //
    // Every alternative added since is `$`-anchored, and that is load-bearing:
    // an unanchored `icon-512` matches as a PREFIX, so `/icon-512999` bypassed
    // auth. `api/v1(?:\/.*)?$` is the shape for "exact path or a real
    // subpath". The pre-existing api/*, shared and _next/* alternatives are
    // left unanchored on purpose - they are meant to match subpaths.
    //
    // NOSONAR (typescript:S7780) - Next statically parses this export and
    // needs a plain literal, so String.raw is not an option here.
    "/((?!api/auth|api/health|api/alerts|api/transactions|api/investments|api/realtime/notify|api\\/v1(?:\\/.*)?$|invite(?:\\/.*)?$|shared|_next/static|_next/image|icon\\.svg$|icon-512$|icon-512-maskable$|icon$|apple-icon$|site\\.webmanifest$|sw\\.js$|.*\\.(?:png|jpg|ico|webp)).*)", // NOSONAR
  ],
};
