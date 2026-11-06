import { prisma } from "@/lib/db/prisma";
import { matchBackupCode, matchTotpStep } from "@/lib/domain/totp";

/**
 * Accepting a second factor once. A plain module, not a "use server" one: it
 * takes a userId, and every caller has already established whose code it is
 * (the login's user, or the session's).
 */

/**
 * A TOTP code, accepted once (RFC 6238 §5.2): its step must be newer than the
 * last step accepted for this user, and recording it is the same write that
 * checks it - two logins racing with one code cannot both win, and a code
 * seen over a shoulder is spent by the time it could be typed again.
 */
export async function consumeTotpCode(userId: string, secret: string, code: string): Promise<boolean> {
  const step = await matchTotpStep(secret, code);
  if (step === null) return false;
  const { count } = await prisma.user.updateMany({
    where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
    data: { totpLastStep: step },
  });
  return count === 1;
}

/**
 * A backup code, used up. Only if the list is still the one it was matched
 * against: a concurrent use of the same code changed it, and loses.
 */
export async function consumeBackupCode(userId: string, code: string, stored: string[]): Promise<boolean> {
  const index = await matchBackupCode(code, stored);
  if (index === -1) return false;
  const { count } = await prisma.user.updateMany({
    where: { id: userId, totpBackupCodes: { equals: stored } },
    data: { totpBackupCodes: stored.filter((_, i) => i !== index) },
  });
  return count === 1;
}
