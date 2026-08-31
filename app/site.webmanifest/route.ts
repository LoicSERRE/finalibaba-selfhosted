import type { MetadataRoute } from "next";

/**
 * The PWA manifest, served from a plain Route Handler.
 *
 * This was `app/manifest.ts`, the file convention, which Next auto-detects and
 * links for you. The link it generates is `<link rel="manifest" href=...>` with
 * no way to add `crossorigin`, and `metadata.manifest` only accepts a URL - so
 * there is no supported way to influence it. Setting `manifest: null` does not
 * suppress it either; the convention wins (verified, two link tags came out).
 *
 * A manifest is fetched WITHOUT credentials by default. Behind an
 * authenticating reverse proxy - Cloudflare Access, Authelia, oauth2-proxy,
 * all recommended in this project's README - that request carries no session
 * cookie, gets redirected to the proxy's login host, and the browser then
 * refuses the cross-origin result under `default-src 'self'`. A real report:
 * "Loading a manifest from https://...cloudflareaccess.com/... violates the
 * following Content Security Policy directive". The install prompt is broken
 * for that whole class of deployment.
 *
 * Moving off the convention lets app/layout.tsx render the tag itself with
 * `crossOrigin="use-credentials"`, which sends the cookie so the proxy lets it
 * through and it stays same-origin. The route name deliberately avoids
 * `manifest` so Next does not auto-detect this as the convention again.
 *
 * Content is unchanged, including why it is generated rather than static: the
 * old public/manifest.json pointed both its "any" and "maskable" icons at the
 * same unpadded icon.svg, and Android's mask crops that. See
 * components/shared/pwa-logo-512.tsx.
 */
export const dynamic = "force-static";

function manifest(): MetadataRoute.Manifest {
  return {
    name: "Finalibaba",
    short_name: "Finalibaba",
    description: "Votre patrimoine, en un coup d'œil",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0f",
    theme_color: "#6366f1",
    orientation: "portrait-primary",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512-maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

export function GET() {
  return Response.json(manifest(), {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
