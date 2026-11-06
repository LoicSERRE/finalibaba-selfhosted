import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { prisma } from "@/lib/db/prisma";
import { isLocalHostname, isPrivateAddress } from "@/lib/domain/network-address";

/**
 * Whether a user's alert email may go through this SMTP host.
 *
 * The optional `mail` service relays for anything on the Docker network with
 * no credentials (docker-mailserver's SMTP_ONLY mode has no SASL, see
 * dev-docs/alerts.md), and signs what it sends with the instance's domain.
 * With every user choosing their own SMTP host, a member pointing theirs at
 * it could send mail under that domain to anyone, saying anything (an alert
 * rule's message is free text). So the instance's own network - the `mail`
 * service, or any private address - is the admin's: a member's alert email
 * goes through a provider of their own (Gmail, Outlook...), sending as them.
 *
 * A name that does not resolve is refused for a member too: nothing could be
 * sent there anyway, and a check that fails open is not one.
 */
export async function smtpHostAllowedFor(userId: string, host: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  return isPublicHost(host);
}

async function isPublicHost(host: string): Promise<boolean> {
  if (isLocalHostname(host)) return false;
  if (isIP(host)) return !isPrivateAddress(host);
  try {
    const addresses = await lookup(host, { all: true });
    return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}
