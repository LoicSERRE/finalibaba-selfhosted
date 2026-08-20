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
  "script-src 'self' 'unsafe-inline'",
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
    ];
  },
};

export default withNextIntl(nextConfig);
