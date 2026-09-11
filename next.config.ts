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
  // The two Google hosts serve the reCAPTCHA widget some banks put in front of
  // their login. script-src already carries 'unsafe-inline', so two host
  // entries change nothing about that ceiling; frame-src is the one new
  // capability, narrowed to one host, and frame-ancestors 'none' still refuses
  // to let anyone frame US.
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
          // No Strict-Transport-Security, deliberately: this app is commonly
          // reached over plain HTTP on a LAN, and HSTS is browser-cached and
          // self-reinforcing - a browser that once received it over HTTP then
          // refuses all future HTTP to this host until manually cleared. A
          // reverse proxy terminating real TLS should set it at that layer.
        ],
      },
      {
        // Every page is force-dynamic and reads live financial data, and Next
        // emits no Cache-Control for that - leaving a browser or a CDN free to
        // apply its own heuristic. Settings showed blank fields after a
        // redeploy for exactly this reason, from a stale HTML response in
        // front of the app.
        //
        // Excludes the same static-asset set as proxy.ts's matcher, reusing
        // that list rather than maintaining a second one that could drift.
        //
        // Not a guarantee: a CDN's own browser-TTL setting can override an
        // origin's Cache-Control. It is still the necessary origin-side
        // signal.
        source:
          "/((?!_next/static|_next/image|icon\\.svg$|icon-512$|icon-512-maskable$|icon$|apple-icon$|site\\.webmanifest$|sw\\.js$|.*\\.(?:png|jpg|ico|webp)).*)", // NOSONAR
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
