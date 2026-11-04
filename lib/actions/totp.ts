"use server";

import { revalidatePath } from "next/cache";
import { decryptSecret, encryptSecret } from "@/lib/domain/crypto-at-rest";
import QRCode from "qrcode";
import { prisma } from "@/lib/db/prisma";
import { getViewer, getViewerForTwoFactorSetup } from "@/lib/auth-context";
import { consumeAttempt } from "@/lib/services/rate-limit";
import {
  generateTotpSecret,
  generateTotpUri,
  verifyTotpCode,
  generateBackupCodes,
  hashBackupCodes,
  matchBackupCode,
} from "@/lib/domain/totp";

// A code-checking action (confirm/disable/regenerate) is a 6-digit guess
// behind a live session. Without a brake, a stolen-but-unlocked session could
// brute-force the 2FA secret. Bounded per user+action, same limiter as login.
const TOTP_MAX_ATTEMPTS = 10;
async function consumeTotpAttempt(userId: string, scope: string): Promise<boolean> {
  return consumeAttempt(`totp|${scope}|${userId}`, TOTP_MAX_ATTEMPTS);
}

// Separate from lib/actions/user-settings.ts - this is a multi-step
// interactive setup/teardown flow, not a single form-submit-and-revalidate
// mutation like the rest of that file.
//
// Every expected failure here is RETURNED, never thrown. Next replaces a
// thrown Server Action error with an opaque digest in production, so "Invalid
// code" reached the user in dev and nothing at all once deployed - which is
// how a real report of "2FA does not work at all" arrived with no way to tell
// a wrong code from a broken flow. Next's own guidance is to model expected
// errors as return values; see lib/actions/sync.ts for the same treatment.
// Keys are stable strings rather than sentences so the UI can translate them.
export type TotpFailure = {
  ok: false;
  error: "invalid_code" | "not_enabled" | "no_pending_setup" | "already_enabled" | "too_many_attempts";
};

// startTotpSetup and confirmTotpSetup resolve the user without the instance
// 2FA policy: they are the way to satisfy it, reached from the gate that
// app/layout.tsx shows instead of the app. The other two need 2FA already on.
export async function startTotpSetup(): Promise<{ qrDataUrl: string; secret: string } | TotpFailure> {
  const secret = generateTotpSecret();
  const viewer = await getViewerForTwoFactorSetup();
  // Refuse to re-arm an already-active 2FA: this writes a brand-new secret, so
  // without the check anyone with the session could silently replace a live
  // authenticator (and void the real one) without proving they hold it.
  // Turning 2FA off first goes through disableTotp, which does require a code.
  const current = await prisma.user.findUnique({ where: { id: viewer.id }, select: { totpEnabled: true } });
  if (current?.totpEnabled) return { ok: false, error: "already_enabled" };
  // totpEnabled stays false until confirmTotpSetup verifies a live code -
  // overwriting any abandoned prior attempt here is safe for that reason.
  await prisma.user.update({
    where: { id: viewer.id },
    data: { totpSecret: encryptSecret(secret), totpEnabled: false },
  });
  const label = await prisma.user
    .findUnique({ where: { id: viewer.id }, select: { username: true, displayName: true } })
    .then((u) => u?.displayName || u?.username || process.env.AUTH_USER_NAME || "owner");
  const uri = generateTotpUri(secret, label);
  const qrDataUrl = await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 1, scale: 6 });
  return { qrDataUrl, secret };
}

export async function confirmTotpSetup(
  code: string,
): Promise<{ ok: true; backupCodes: string[] } | TotpFailure> {
  const viewer = await getViewerForTwoFactorSetup();
  if (!(await consumeTotpAttempt(viewer.id, "confirm"))) return { ok: false, error: "too_many_attempts" };
  const settings = await prisma.user.findUnique({
    where: { id: viewer.id },
    select: { totpSecret: true },
  });
  if (!settings?.totpSecret) return { ok: false, error: "no_pending_setup" };
  if (!(await verifyTotpCode(decryptSecret(settings.totpSecret)!, code))) return { ok: false, error: "invalid_code" };

  const backupCodes = generateBackupCodes();
  const hashed = await hashBackupCodes(backupCodes);
  await prisma.user.update({
    where: { id: viewer.id },
    data: { totpEnabled: true, totpBackupCodes: hashed },
  });
  // No revalidation here, on purpose: under the instance policy this runs
  // inside the layout's 2FA gate, and re-rendering now would swap that gate -
  // and the backup codes on it - for the app before they were written down.
  // The client refreshes once they are dismissed (handleFinishEnable).
  return { ok: true, backupCodes }; // plaintext, shown once - never persisted
}

export async function disableTotp(code: string): Promise<{ ok: true } | TotpFailure> {
  const viewer = await getViewer();
  if (!(await consumeTotpAttempt(viewer.id, "disable"))) return { ok: false, error: "too_many_attempts" };
  const settings = await prisma.user.findUnique({
    where: { id: viewer.id },
    select: { totpEnabled: true, totpSecret: true, totpBackupCodes: true },
  });
  if (!settings?.totpEnabled || !settings.totpSecret) return { ok: false, error: "not_enabled" };

  const ok =
    (await verifyTotpCode(decryptSecret(settings.totpSecret)!, code)) ||
    (await matchBackupCode(code, settings.totpBackupCodes)) !== -1;
  if (!ok) return { ok: false, error: "invalid_code" };

  await prisma.user.update({
    where: { id: viewer.id },
    data: { totpEnabled: false, totpSecret: null, totpBackupCodes: [] },
  });
  revalidatePath("/settings");
  return { ok: true };
}

export async function regenerateBackupCodes(
  code: string,
): Promise<{ ok: true; backupCodes: string[] } | TotpFailure> {
  const viewer = await getViewer();
  if (!(await consumeTotpAttempt(viewer.id, "regen"))) return { ok: false, error: "too_many_attempts" };
  const settings = await prisma.user.findUnique({
    where: { id: viewer.id },
    select: { totpEnabled: true, totpSecret: true },
  });
  if (!settings?.totpEnabled || !settings.totpSecret) return { ok: false, error: "not_enabled" };
  // A live TOTP code only, never a backup code here - otherwise a single
  // backup code could mint itself an endless supply of replacements
  // without ever proving possession of the authenticator app.
  if (!(await verifyTotpCode(decryptSecret(settings.totpSecret)!, code))) return { ok: false, error: "invalid_code" };

  const backupCodes = generateBackupCodes();
  const hashed = await hashBackupCodes(backupCodes);
  await prisma.user.update({
    where: { id: viewer.id },
    data: { totpBackupCodes: hashed },
  });
  revalidatePath("/settings");
  return { ok: true, backupCodes };
}
