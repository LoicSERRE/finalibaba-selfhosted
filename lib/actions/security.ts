"use server";

import { getViewer, requireAdmin } from "@/lib/auth-context";
import { prisma } from "@/lib/db/prisma";
import { updateInstanceTwoFactorPolicy } from "@/lib/services/two-factor-policy";

/**
 * Reads for the Security section, plus the one policy toggle that belongs to
 * the instance rather than to a person.
 *
 * Kept apart from lib/actions/users.ts because the audience differs: every
 * user sees their own events, only an admin sees everyone's, and mixing the
 * two scopes in one file is how a read ends up answering for the wrong person.
 */

/** How many events a page shows. Not a feature limit, a safety cap. */
const AUDIT_PAGE_SIZE = 50;

export type AuditRow = {
  id: string;
  createdAt: Date;
  action: string;
  actorLabel: string | null;
  targetType: string | null;
  detail: string | null;
  ip: string | null;
};

/**
 * The audit trail.
 *
 * An admin sees the whole instance; anyone else sees only the events they
 * caused. A member reading the admin's backup downloads would be a disclosure
 * of its own, and a member unable to see their OWN logins could not answer the
 * one question the log exists for: "was that me?".
 */
export async function getAuditLog(): Promise<AuditRow[]> {
  const viewer = await getViewer();
  return prisma.auditLog.findMany({
    where: viewer.role === "ADMIN" ? {} : { actorId: viewer.id },
    orderBy: { createdAt: "desc" },
    take: AUDIT_PAGE_SIZE,
    select: {
      id: true, createdAt: true, action: true,
      actorLabel: true, targetType: true, detail: true, ip: true,
    },
  });
}

/** Whether this instance requires every user to set up TOTP. */
export async function setTwoFactorPolicy(formData: FormData): Promise<void> {
  await requireAdmin();
  await updateInstanceTwoFactorPolicy(formData.get("requireTwoFactor") === "on");
}
