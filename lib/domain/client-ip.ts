import { isIP } from "node:net";

/**
 * Which address a login attempt is counted against.
 *
 * `X-Forwarded-For` is a list every proxy APPENDS to: a client can put
 * anything it likes at the front, and each proxy adds the address of whoever
 * connected to it at the end. So the only entries worth anything are the ones
 * written by proxies we run, counted from the RIGHT - and the left-most value,
 * which is what this used to read, is exactly the one the client controls.
 * Behind Nginx's `proxy_add_x_forwarded_for` a forged `X-Forwarded-For: 1.2.3.4`
 * arrives as `1.2.3.4, <real address>`, and reading position 0 handed every
 * request its own fresh rate-limit bucket.
 *
 * `trustedProxyCount` is how many proxies the operator runs in front of the
 * app (`TRUSTED_PROXY_COUNT`). With N of them, the client is the N-th entry
 * from the right: the address the outermost trusted proxy saw connect to it.
 *
 * With 0 (the default), no forwarding header is trusted at all. That is not a
 * loss: Next only fills `X-Forwarded-For` from the socket when the header is
 * absent (`??=` in base-server), so on a directly exposed instance the header
 * is either the real peer or whatever the client chose, and nothing here can
 * tell the two apart. Every attempt then shares the "unknown" bucket, which
 * makes the limiter per-account rather than per-address - stricter, never
 * weaker.
 */
export const UNKNOWN_CLIENT = "unknown";

type HeaderBag = Record<string, unknown> | undefined;

function header(headers: HeaderBag, name: string): string | undefined {
  const value = headers?.[name];
  if (typeof value === "string") return value;
  // Node can deliver a repeated header as an array; proxies append in order.
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string").join(",");
  return undefined;
}

function validIp(candidate: string | undefined): string | null {
  if (!candidate) return null;
  const trimmed = candidate.trim();
  return isIP(trimmed) ? trimmed : null;
}

export function clientIpFromHeaders(headers: HeaderBag, trustedProxyCount: number): string {
  const trusted = Number.isInteger(trustedProxyCount) && trustedProxyCount > 0 ? trustedProxyCount : 0;
  if (trusted === 0) return UNKNOWN_CLIENT;

  const chain = (header(headers, "x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (chain.length > 0) {
    // Fewer entries than trusted proxies means every entry present was
    // written by one of ours, so the left-most is as far as the chain goes.
    const index = Math.max(0, chain.length - trusted);
    return validIp(chain[index]) ?? UNKNOWN_CLIENT;
  }

  // No chain at all: a proxy that sets X-Real-IP overwrites any client value
  // (Nginx `proxy_set_header X-Real-IP $remote_addr`), so it is only read when
  // the operator has told us such a proxy exists.
  return validIp(header(headers, "x-real-ip")) ?? UNKNOWN_CLIENT;
}

/** Reads `TRUSTED_PROXY_COUNT`, treating anything unparseable as 0. */
export function trustedProxyCountFromEnv(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}
