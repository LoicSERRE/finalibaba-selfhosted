import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// The Content-Security-Policy is NOT here any more: script-src carries a
// per-request nonce, which static config cannot produce. proxy.ts sets it,
// from lib/domain/content-security-policy.ts, on both the request (so Next can
// stamp its own scripts) and the response. Everything below stays here -
// none of it varies per request.

const nextConfig: NextConfig = {
  serverExternalPackages: ["next-auth", "bcryptjs"],
  // Removes the X-Powered-By: Next.js response header (minor info disclosure).
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
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
