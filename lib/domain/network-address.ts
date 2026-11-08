import { isIP } from "node:net";

/**
 * Whether an address is this machine's or its private network's rather than
 * the internet's: loopback, RFC 1918, link-local, carrier-grade NAT, the
 * unspecified address, IPv6 unique-local and link-local, and an IPv4 address
 * mapped into IPv6. Not an IP at all is not "private" - resolve it first.
 */
export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version !== 6) return false;
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateIpv4(mapped[1]);
  if (v6 === "::" || v6 === "::1") return true;
  // fc00::/7 (unique local) and fe80::/10 (link-local).
  return /^f[cd][0-9a-f]{0,2}:/.test(v6) || /^fe[89ab][0-9a-f]?:/.test(v6);
}

function isPrivateIpv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** A name with no dot - `mail`, `sync`, `localhost` - is a local one: a
 *  Docker service or the machine itself, never a public mail provider. */
export function isLocalHostname(host: string): boolean {
  const name = host.trim().toLowerCase().replace(/\.$/, "");
  return name === "localhost" || name.endsWith(".localhost") || (isIP(name) === 0 && !name.includes("."));
}
