/**
 * Whether a state-changing request came from this app's own pages.
 *
 * Route Handlers get none of the Origin checking Next applies to Server
 * Actions, and a multipart POST is a "simple" request a browser sends
 * cross-site without any preflight. On an instance with AUTH_ENABLED off -
 * the default - there is no cookie to withhold either, so a page on any other
 * site could submit a form to `/api/backup` and replace the whole database.
 * This is the check that refuses it.
 *
 * Two modes, by design:
 * - `APP_URL` set: the Origin must be exactly that origin (scheme, host,
 *   port). This is the strict mode, and the only one that also stands up to
 *   DNS rebinding, where an attacker's hostname resolves to the instance and
 *   the browser sends a matching Host header.
 * - `APP_URL` unset: the Origin's host must equal the host the request was
 *   addressed to (`X-Forwarded-Host` when a proxy set it, else `Host`) - the
 *   same comparison Next makes for Server Actions, so a LAN instance reached by
 *   IP keeps working with no configuration.
 *
 * A missing or unparseable Origin is refused. Every browser sends Origin on a
 * POST; a request without one is not coming from this app's UI.
 */
export type OriginCheckInput = {
  origin: string | null;
  host: string | null;
  forwardedHost: string | null;
  appUrl: string | undefined;
};

function parseOrigin(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isAllowedOrigin({ origin, host, forwardedHost, appUrl }: OriginCheckInput): boolean {
  if (!origin || origin === "null") return false;
  const requestOrigin = parseOrigin(origin);
  if (!requestOrigin) return false;

  const configured = appUrl?.trim() ? parseOrigin(appUrl.trim()) : null;
  if (configured) return requestOrigin.origin === configured.origin;

  // A proxy may send a comma-separated list; the first value is the host the
  // client asked for.
  const addressed = (forwardedHost?.split(",")[0] ?? host ?? "").trim().toLowerCase();
  if (!addressed) return false;
  return requestOrigin.host.toLowerCase() === addressed;
}
