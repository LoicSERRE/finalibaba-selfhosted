import { withAuth, type NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { buildContentSecurityPolicy, generateCspNonce } from "@/lib/domain/content-security-policy";

/**
 * Demo mode is read-only. Returns a 403 for any mutating request, or null to
 * let it through.
 *
 * **Enforced in the top-level middleware, before the auth-exemption check -
 * not inside `authMiddleware`.** It used to live in the `withAuth` wrapper,
 * which only runs for auth-GATED paths; an auth-exempt route (`/shared`,
 * `/invite`, `/api/alerts`...) never reached it, so a Server Action POSTed at
 * one of those paths ran its mutation on a public demo instance (audited: an
 * anonymous POST created an Invitation). A Server Action's path is the page it
 * is bound to, so the exempt pages are a real write surface. The gate is the
 * HTTP method, which no caller can disguise: every Server Action is a POST.
 */
function refuseDemoMutation(req: NextRequest): NextResponse | null {
  if (process.env.DEMO_MODE === "true" && req.method !== "GET" && req.method !== "HEAD") {
    return new NextResponse(
      JSON.stringify({ error: "Mode démo - données en lecture seule." }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }
  return null;
}

/**
 * The public token pages take no writes - enforced here, not left to the
 * actions. A Server Action is a POST to whichever page it is called at, and
 * with AUTH_ENABLED off every request is the owner, so a page reachable
 * without the app (a share link's documented use: no app password needed)
 * must not be a way in to the owner's actions. `/shared` never takes a write.
 * `/invite` takes one (accepting) only with auth on, the only mode
 * invitations exist in.
 */
export function refusesPublicPageWrite(pathname: string, method: string, authEnabled: boolean): boolean {
  if (method === "GET" || method === "HEAD") return false;
  if (/^\/shared(?:\/.*)?$/.test(pathname)) return true;
  return !authEnabled && /^\/invite(?:\/.*)?$/.test(pathname);
}

const authMiddleware = withAuth(
  function middleware() {},
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

/**
 * Paths that must NOT go through the NextAuth session gate.
 *
 * **This list used to BE `config.matcher`, as one negative-lookahead regex,
 * and moving it here is the whole delicate part of the change.** The matcher
 * now has to run on more paths than
 * the auth gate does, because every page needs a per-request CSP nonce and the
 * excluded ones (`/shared/<token>`, `/invite/<token>`, the icon routes) are
 * real pages a browser renders. Leaving them on the old matcher would have
 * given them no CSP at all - a silent downgrade on exactly the two routes an
 * anonymous visitor can reach.
 *
 * The alternatives are the same ones the matcher carried, split one per line
 * so each anchor is visible instead of buried in a 300-character lookahead -
 * `__tests__/proxy-matcher.test.ts` still pins every case, because the
 * failure modes have bitten this project twice: too narrow and a legitimately
 * public page becomes unreachable (the whole invitation flow was, on an
 * AUTH_ENABLED instance), too broad and a private one stops being gated.
 *
 * Every alternative added since is `$`-anchored, and that is load-bearing: an
 * unanchored `icon-512` matches as a PREFIX, so `/icon-512999` bypassed auth.
 * `api\/v1(?:\/.*)?$` is the shape for "exact path or a real subpath". The
 * pre-existing `api/*`, `shared` and `_next/*` alternatives are left unanchored
 * on purpose - they are meant to match subpaths.
 */
const AUTH_EXEMPT: RegExp[] = [
  // Every entry is "exact path or a real subpath" (`(?:\/.*)?$`), never a bare
  // prefix: an unanchored `/api/transactions` also matched `/api/transactionsX`,
  // so any future route whose name merely starts with an exempt one would have
  // skipped the session gate. The same mistake once let `/api/v1999` through.
  // NextAuth's own endpoints, and the compose healthcheck.
  /^\/api\/auth(?:\/.*)?$/,
  /^\/api\/health(?:\/.*)?$/,
  // Container-to-container callers with no cookie, each gated by the
  // internal bearer token (lib/services/internal-auth.ts). api/realtime/STREAM is
  // deliberately absent: the browser opens that one and it needs the session.
  /^\/api\/alerts(?:\/.*)?$/,
  /^\/api\/transactions(?:\/.*)?$/,
  /^\/api\/investments(?:\/.*)?$/,
  /^\/api\/realtime\/notify(?:\/.*)?$/,
  /^\/api\/v1(?:\/.*)?$/,
  // Token-gated pages that must work with auth on or off. Without `invite`
  // an AUTH_ENABLED instance sent every invitee to a login page they cannot
  // get past, which made the whole flow unreachable.
  /^\/invite(?:\/.*)?$/,
  /^\/shared(?:\/.*)?$/,
  // Build assets.
  /^\/_next\/static/,
  /^\/_next\/image/,
  // Generated assets with no file extension for the image branch to catch.
  // Every one `$`-anchored: unanchored, `/icon-512999` bypassed auth.
  /^\/icon\.svg$/,
  /^\/icon-512$/,
  /^\/icon-512-maskable$/,
  /^\/icon$/,
  /^\/apple-icon$/,
  /^\/site\.webmanifest$/,
  /^\/sw\.js$/,
  // The one real image file outside public/: app/favicon.ico. Named exactly,
  // never by extension - an unanchored /\.(?:png|jpg|ico|webp)/ used to sit
  // here, and since dynamic segments accept dots it exempted
  // /accounts/<anything>.png and /budgets/<anything>.png from the session
  // gate, protecting no real file in exchange (public/ holds none).
  /^\/favicon\.ico$/,
];

/** True when the session gate applies to this path. */
export function isAuthGated(pathname: string): boolean {
  return !AUTH_EXEMPT.some((exempt) => exempt.test(pathname));
}

/**
 * Whether what `withAuth` handed back is a refusal rather than a permission.
 *
 * **Never `instanceof NextResponse`, and this function exists because that is
 * exactly what it used to be.** next-auth bundles its own copy of
 * `next/server`, so the `NextResponse` it constructs is a DIFFERENT class
 * object from the one imported here - `instanceof` answered **false** for a
 * genuine `307` to `/login`, the code fell through to `NextResponse.next()`,
 * and the refusal became an authorisation. Every authenticated page served the
 * instance owner's data to requests carrying no session at all, because
 * `getViewer()`'s owner fallback is reachable precisely when there is none.
 *
 * Measured rather than reasoned about: a probe in this function logged
 * `ctor=NextResponse isNextResponse=false status=307 location=/login`. The
 * constructor name was right and the identity check was still wrong.
 *
 * So this asks what the response SAYS, not which class built it. A duck-typed
 * check cannot be defeated by a second copy of a module, and this is a gate
 * whose failure mode is silent: nothing logs, nothing throws, and the page
 * renders perfectly - for anybody.
 */
export function isAuthDenial(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const response = result as { status?: unknown; headers?: { get?: (k: string) => unknown } };
  if (typeof response.status !== "number") return false;
  // A redirect to the sign-in page, or any non-200 (withAuth answers an
  // unauthorised API route with 401 rather than a redirect).
  return response.status !== 200 || Boolean(response.headers?.get?.("location"));
}

/** Copies the security headers onto whatever response we end up returning. */
function withCsp(res: NextResponse, csp: string): NextResponse {
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  const nonce = generateCspNonce();
  const csp = buildContentSecurityPolicy(nonce);

  // Next reads the nonce off the REQUEST headers to stamp its own framework
  // scripts and inline snippets. Setting it only on the response would leave
  // every one of them unnonced, and - since a nonce disables 'unsafe-inline' -
  // that renders a blank page rather than a less secure one.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  // The layout renders on every route and has no other way to know which
  // one: the two-factor gate has to let /settings through, since that is
  // where the setup it demands actually lives.
  requestHeaders.set("x-pathname", req.nextUrl.pathname);
  requestHeaders.set("Content-Security-Policy", csp);
  const pass = () => NextResponse.next({ request: { headers: requestHeaders } });

  // Before everything else, including the auth-exemption check below: demo mode
  // must refuse a write to an auth-exempt path too (a Server Action POSTed at
  // /shared or /invite). See refuseDemoMutation.
  const demoRefusal = refuseDemoMutation(req);
  if (demoRefusal) return withCsp(demoRefusal, csp);
  // Same place, same reason: before the exemption below lets the path through.
  if (refusesPublicPageWrite(req.nextUrl.pathname, req.method, process.env.AUTH_ENABLED === "true")) {
    return withCsp(new NextResponse(null, { status: 405, headers: { Allow: "GET, HEAD" } }), csp);
  }

  // withAuth never redirects AWAY from /login, so a stale bookmark from a time
  // AUTH_ENABLED was on shows the password form forever. Handled here rather
  // than in the page: redirect() from /login itself trips a Next client-router
  // bug (React #310) when it fires mid-stream.
  if (req.nextUrl.pathname === "/login" && process.env.AUTH_ENABLED !== "true") {
    return withCsp(NextResponse.redirect(new URL("/", req.url)), csp);
  }

  if (!isAuthGated(req.nextUrl.pathname)) return withCsp(pass(), csp);

  const authResult = await authMiddleware(req as NextRequestWithAuth, event);
  // withAuth answers a permitted request with nothing, or with a bare `next()`
  // that knows nothing about the request headers above - either way the
  // request has to be re-issued by us or the nonce never reaches the renderer.
  // Anything carrying a redirect or a non-200 status is a DECISION, and is
  // returned exactly as it stands.
  if (isAuthDenial(authResult)) return withCsp(authResult as NextResponse, csp);
  return withCsp(pass(), csp);
}

export const config = {
  matcher: [
    // Deliberately wider than the auth gate: every HTML response needs its own
    // CSP nonce, so the middleware has to run on the public token pages too.
    // Only genuinely static files are skipped, and they are NAMED: skipping by
    // extension also skipped the gate for any page route whose last segment
    // ended in one (/accounts/x.png rendered with no session at all).
    //
    // NOSONAR (typescript:S7780) - Next statically parses this export and
    // needs a plain literal, so String.raw is not an option here.
    "/((?!_next/static|_next/image|favicon\\.ico$|icon\\.svg$).*)", // NOSONAR
  ],
};
