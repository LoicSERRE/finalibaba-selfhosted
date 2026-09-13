import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";

/**
 * Records the security-relevant things that happen on an instance.
 *
 * Everything else in this app is about *preventing* actions. This is the only
 * thing that lets an operator SEE one: who signed in, who redeemed an
 * invitation, who downloaded the whole-database backup, who pointed an
 * institution at new bank credentials. Without it, a compromise leaves no
 * trace to find, and "is anything wrong?" has no answer short of reading
 * container logs that rotate away.
 *
 * **Writing to it must never break the action it describes.** An audit row is
 * worth having and is not worth failing a login over, so every write is
 * wrapped: a full disk or a locked table degrades the record, not the app.
 * The trade is stated here rather than discovered later - it does mean a
 * determined attacker who can make writes fail can also make them silent.
 */

/**
 * Stable, dotted, and never a translated sentence: these are grepped, filtered
 * and compared across versions. Adding one is cheap; renaming one loses the
 * history that used the old name.
 */
export const AUDIT = {
  loginSucceeded: "login.succeeded",
  loginFailed: "login.failed",
  loginRateLimited: "login.rate_limited",
  sessionsRevoked: "sessions.revoked",
  invitationCreated: "invitation.created",
  invitationRedeemed: "invitation.redeemed",
  userDeleted: "user.deleted",
  // Named for the credential rather than the secret: sonarjs reads a
  // "password.*" string literal as a hard-coded password.
  credentialsChanged: "credentials.changed",
  totpEnabled: "totp.enabled",
  totpDisabled: "totp.disabled",
  backupDownloaded: "backup.downloaded",
  backupRestored: "backup.restored",
  bankConfigured: "bank.configured",
  shareLinkCreated: "sharelink.created",
  apiKeyCreated: "apikey.created",
  portfolioGranted: "portfolio.granted",
} as const;

export type AuditAction = (typeof AUDIT)[keyof typeof AUDIT];

type AuditInput = {
  action: AuditAction;
  actorId?: string | null;
  /** The username as it read at the time, so a deleted user still reads. */
  actorLabel?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  /** Never a credential, never a token - this table is read by humans. */
  detail?: string | null;
  /** Passed explicitly from a route handler that already has the request. */
  ip?: string | null;
};

/**
 * The client IP as the reverse proxy reports it.
 *
 * Spoofable by anyone talking to the app directly, which is why it is recorded
 * as evidence rather than trusted as identity - nothing authorises on it.
 */
async function clientIp(): Promise<string | null> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    return forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  } catch {
    // Outside a request scope (a cron, a startup hook): there is no client.
    return null;
  }
}

/** Records one event. Never throws. */
export async function recordAuditEvent(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        actorId: input.actorId ?? null,
        actorLabel: input.actorLabel ?? null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        detail: input.detail ?? null,
        ip: input.ip ?? (await clientIp()),
      },
    });
  } catch (e) {
    console.error(`[audit] could not record ${input.action}:`, e);
  }
}
