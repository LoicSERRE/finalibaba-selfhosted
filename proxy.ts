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
    // invite is excluded for exactly the same reason as shared, and it is a
    // correctness requirement rather than a nicety: app/invite/[token] is the
    // screen where someone who has NO account yet creates one. Without this
    // exclusion, an AUTH_ENABLED=true instance redirects every invitee to
    // /login - a page they cannot possibly get past - making the entire
    // invitation flow unreachable. Found by the post-v2.0 security audit, not
    // by the multi-user build itself, whose own tests created users directly
    // in the database and so never went through this page. Anchored the same
    // way as api/v1 above (`invite(?:\/.*)?$`), so /invite/<token> and a bare
    // /invite match but a prefix collision like /invite999 does not. The page
    // is its own gate: an unknown, used or expired token is notFound(),
    // uniformly, exactly like a share link.
    // api/alerts, api/transactions (specifically auto-categorize), and
    // api/investments (specifically snapshot-balances) are excluded for the
    // same "no browser session on this call path" reason as
    // api/auth/api/health: sync/main.py calls all three directly,
    // container-to-container, with no cookie to present - each gates
    // itself via a NEXTAUTH_SECRET bearer token instead. See CLAUDE.md's
    // "Alerts & webhooks" and "Historical value chart per investment
    // account" sections.
    // api/realtime/notify is the same category, one more container-to-
    // container caller (sync/sync_tr_realtime.py) - api/realtime/stream is
    // deliberately NOT listed here, it's opened directly by the browser and
    // needs the normal session. See CLAUDE.md's "Trade Republic real-time
    // tracking".
    // NOSONAR (typescript:S7780) - this `config` export is statically parsed
    // by Next.js's middleware build step (extractExportedConstValue), which
    // requires a plain literal - a String.raw tagged-template expression here
    // isn't statically evaluable and makes the build fail with "Invalid
    // segment configuration export detected" (confirmed by testing it).
    //
    // icon/apple-icon/icon-512/icon-512-maskable are Next's generated icon
    // routes (app/icon.tsx, app/apple-icon.tsx, app/icon-512/route.tsx,
    // app/icon-512-maskable/route.tsx - see CLAUDE.md's "PWA / offline
    // support") - none had a literal file extension in their URL for the
    // pre-existing `.(?:png|jpg|ico|webp)` branch below to catch, so on an
    // AUTH_ENABLED=true instance every one of them would have been silently
    // redirected to /login instead of serving the actual image, breaking
    // browser tab favicons, iOS home-screen install, and PWA install
    // prompts alike. site.webmanifest (app/site.webmanifest/route.ts - named
    // that way so Next does not auto-link it, see that file) and sw.js
    // (public/sw.js) need the same treatment for the same reason - a
    // service worker or manifest fetch has no business going through a
    // login redirect either.
    //
    // Every new alternative below is `$`-anchored (added to the pre-existing
    // icon\.svg too, while touching this line anyway) - confirmed live
    // against a real AUTH_ENABLED=true dev server that an *unanchored*
    // `icon-512` alternative matches as a bare prefix, not an exact path:
    // a nonexistent `/icon-512999` was bypassing auth entirely (a harmless
    // 404 either way here, but the wrong reason - not a path this matcher
    // was ever meant to exempt). Deliberately not extending this same
    // anchoring pass to the pre-existing, unrelated api/*, shared, or
    // _next/* alternatives above - out of scope for this fix and not
    // verified against their own subpath semantics (shared/_next/* are
    // meant to match subpaths, so `$`-anchoring them the same naive way
    // would break them; api/* likely has the identical latent prefix-match
    // quirk but is pre-existing, untouched by this session either way).
    //
    // api/v1 (the read-only REST API - see CLAUDE.md's "Public REST API")
    // needs the same "exact path or a real subpath" shape as shared above,
    // not a bare prefix (which would repeat the icon-512 mistake) and not
    // a `$`-only exact match either (every real endpoint lives under
    // api/v1/<something>). `api\/v1(?:\/.*)?$` matches `/api/v1` and
    // `/api/v1/net-worth` alike, but not a bare-prefix collision like
    // `/api/v1999` - verified with the same live-server method as above,
    // not just reasoned through.
    "/((?!api/auth|api/health|api/alerts|api/transactions|api/investments|api/realtime/notify|api\\/v1(?:\\/.*)?$|invite(?:\\/.*)?$|shared|_next/static|_next/image|icon\\.svg$|icon-512$|icon-512-maskable$|icon$|apple-icon$|site\\.webmanifest$|sw\\.js$|.*\\.(?:png|jpg|ico|webp)).*)", // NOSONAR
  ],
};
