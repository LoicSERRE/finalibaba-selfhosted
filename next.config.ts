import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// script-src/style-src need 'unsafe-inline' for Next's own RSC hydration
// payload and CSS-in-JS - a nonce-based CSP would remove that but needs a
// per-request nonce threaded from proxy.ts through the root layout, which is
// a much bigger change for a self-hosted app that's usually behind a VPN or
// on a private network already. This is still real defense-in-depth against
// injected <img>/<iframe>/third-party-script content, just not a strict CSP.
const CSP = [
  "default-src 'self'",
  // www.google.com/recaptcha + www.gstatic.com serve the reCAPTCHA widget a
  // bank like Amundi puts in front of its login (components/settings/
  // recaptcha-widget.tsx). Worth being explicit about what this does and does
  // not cost: script-src already carries 'unsafe-inline', so anyone able to
  // inject markup into this app can already run arbitrary JS - adding two
  // host allowlist entries alongside it changes nothing about that ceiling.
  // frame-src below is the one genuinely new capability, and it is the
  // narrowest form of it (one host, no wildcard, framing outward only -
  // frame-ancestors 'none' still refuses to let anyone frame US).
  "script-src 'self' 'unsafe-inline' https://www.google.com https://www.gstatic.com",
  "frame-src 'self' https://www.google.com",
  // Falls back to script-src without this, which already covers same-origin
  // /sw.js (components/layout/service-worker-registration.tsx) - explicit
  // anyway rather than relying on every browser's CSP3 fallback behavior
  // being implemented identically.
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // www.google.com/s2/favicons (lib/domain/institutions.ts) actually serves
  // the image from a redirect to *.gstatic.com, not google.com itself -
  // verified with a real browser (Playwright), not just by reading the URL.
  "img-src 'self' data: https://www.google.com https://*.gstatic.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  serverExternalPackages: ["next-auth", "bcryptjs"],
  // Removes the X-Powered-By: Next.js response header (minor info disclosure).
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // No Strict-Transport-Security here deliberately: this app is
          // commonly reached over plain HTTP on a private LAN/VPN (see
          // CLAUDE.md's "Authentication" section - AUTH_ENABLED defaults to
          // off precisely because network-level trust is the expected
          // setup). HSTS is a browser-cached, self-reinforcing header - if a
          // LAN user's browser ever received it over plain HTTP, it would
          // then refuse all future plain-HTTP connections to this host until
          // manually cleared. Reverse proxies that terminate real TLS
          // (Nginx Proxy Manager, Caddy, Traefik) should set HSTS themselves
          // at that layer instead, where "this connection is actually HTTPS"
          // is actually true.
        ],
      },
      {
        // Every page here is force-dynamic and reads live, per-user
        // financial data (see CLAUDE.md's route table - almost nothing is
        // static) - Next.js does not itself emit a Cache-Control header for
        // that, which leaves the gap open for a browser or an intermediary
        // (a reverse proxy, a CDN) to apply its OWN default caching
        // heuristic instead. Real production report: Settings' financial
        // profile fields showed 0/blank after a redeploy, which turned out
        // to be exactly this - a stale HTML response served from in front
        // of the app, not a database issue.
        //
        // Excludes the same static-asset set proxy.ts's own matcher already
        // excludes, for the mirror-image reason: those genuinely are
        // build-time-fixed or content-hashed and SHOULD be cached. Reusing
        // that exact list rather than a second, independently-maintained one
        // that could drift from it.
        //
        // This alone does not guarantee a downstream cache is bypassed - a
        // CDN's own "Browser Cache TTL"-style setting can still override an
        // origin's Cache-Control regardless of what it says, which is a
        // dashboard setting on the CDN side, not something this header can
        // force. It is still the correct, necessary origin-side signal.
        source:
          "/((?!_next/static|_next/image|icon\\.svg$|icon-512$|icon-512-maskable$|icon$|apple-icon$|site\\.webmanifest$|sw\\.js$|.*\\.(?:png|jpg|ico|webp)).*)", // NOSONAR
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
