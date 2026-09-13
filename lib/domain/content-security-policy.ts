/**
 * The one place the Content-Security-Policy is written.
 *
 * It moved out of `next.config.ts` when `script-src` gained a per-request
 * nonce: a nonce cannot come from static config, only from something that runs
 * per request, which is `proxy.ts`. Both still need the same string, and two
 * copies of a security header is how they stop agreeing.
 *
 * **Why the nonce matters more than it looks.** Once a nonce is present,
 * browsers IGNORE `'unsafe-inline'` in the same directive (CSP2 onwards), so
 * adding one does not merely add an allowance - it removes the blanket
 * permission that let ANY inline script run. Next applies the nonce to its own
 * framework scripts, page bundles and inline snippets by reading the CSP off
 * the request headers, which is why proxy.ts sets it there as well as on the
 * response. Every page in this app is `force-dynamic`, so there is no
 * statically rendered page for which no nonce could exist.
 *
 * **`style-src` deliberately keeps `'unsafe-inline'`.** Nonce-ing styles too
 * is the documented next step and is a different risk: an inline style that
 * misses its nonce renders the app unstyled rather than merely inert, and
 * Tailwind v4 plus Next's own critical-CSS inlining supply more of them than
 * scripts. Injected CSS is also a far smaller prize than injected script. Left
 * as a deliberate, stated gap rather than a silent one.
 *
 * No `'strict-dynamic'`: it would make browsers that support it ignore the
 * Google host entries below, and those are what let a bank's reCAPTCHA load.
 * The host allowlist is doing real work here, so it stays authoritative.
 */
export function buildContentSecurityPolicy(nonce?: string): string {
  const scriptSrc = [
    "'self'",
    // Without a nonce (the fallback path, see proxy.ts) this reverts to the
    // pre-v2.10.6 behaviour rather than blocking every inline script and
    // taking the page down.
    nonce ? `'nonce-${nonce}'` : "'unsafe-inline'",
    // The two Google hosts serve the reCAPTCHA widget some banks put in front
    // of their login. frame-src below is the one genuinely new capability,
    // narrowed to one host, and frame-ancestors 'none' still refuses to let
    // anyone frame US.
    "https://www.google.com",
    "https://www.gstatic.com",
  ].join(" ");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "frame-src 'self' https://www.google.com",
    // Falls back to script-src without this, which already covers same-origin
    // /sw.js (components/layout/service-worker-registration.tsx) - explicit
    // anyway rather than relying on every browser's CSP3 fallback behaviour
    // being implemented identically.
    "worker-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    // www.google.com/s2/favicons (lib/domain/institutions.ts) actually serves
    // the image from a redirect to *.gstatic.com, not google.com itself -
    // verified with a real browser, not just by reading the URL.
    "img-src 'self' data: https://www.google.com https://*.gstatic.com",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** 128 bits, base64. Unpredictable per request is the whole security property. */
export function generateCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
