"use server";

import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { prisma } from "@/lib/db/prisma";
import {
  generateTotpSecret,
  generateTotpUri,
  verifyTotpCode,
  generateBackupCodes,
  hashBackupCodes,
  matchBackupCode,
} from "@/lib/domain/totp";

// Separate from lib/actions/user-settings.ts - this is a multi-step
// interactive setup/teardown flow, not a single form-submit-and-revalidate
// mutation like the rest of that file.

export async function startTotpSetup(): Promise<{ qrDataUrl: string; secret: string }> {
  const secret = generateTotpSecret();
  // totpEnabled stays false until confirmTotpSetup verifies a live code -
  // overwriting any abandoned prior attempt here is safe for that reason.
  await prisma.userSettings.upsert({
    where: { id: "singleton" },
    create: { totpSecret: secret, totpEnabled: false },
    update: { totpSecret: secret, totpEnabled: false },
  });
  const uri = generateTotpUri(secret, process.env.AUTH_USER_NAME ?? "owner");
  const qrDataUrl = await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 1, scale: 6 });
  return { qrDataUrl, secret };
}

export async function confirmTotpSetup(code: string): Promise<{ backupCodes: string[] }> {
  const settings = await prisma.userSettings.findUnique({
    where: { id: "singleton" },
    select: { totpSecret: true },
  });
  if (!settings?.totpSecret) throw new Error("No pending 2FA setup");
  if (!(await verifyTotpCode(settings.totpSecret, code))) throw new Error("Invalid code");

  const backupCodes = generateBackupCodes();
  const hashed = await hashBackupCodes(backupCodes);
  await prisma.userSettings.update({
    where: { id: "singleton" },
    data: { totpEnabled: true, totpBackupCodes: hashed },
  });
  revalidatePath("/settings");
  return { backupCodes }; // plaintext, shown once - never persisted
}

export async function disableTotp(code: string): Promise<void> {
  const settings = await prisma.userSettings.findUnique({
    where: { id: "singleton" },
    select: { totpEnabled: true, totpSecret: true, totpBackupCodes: true },
  });
  if (!settings?.totpEnabled || !settings.totpSecret) throw new Error("2FA is not enabled");

  const ok =
    (await verifyTotpCode(settings.totpSecret, code)) ||
    (await matchBackupCode(code, settings.totpBackupCodes)) !== -1;
  if (!ok) throw new Error("Invalid code");

  await prisma.userSettings.update({
    where: { id: "singleton" },
    data: { totpEnabled: false, totpSecret: null, totpBackupCodes: [] },
  });
  revalidatePath("/settings");
}

export async function regenerateBackupCodes(code: string): Promise<{ backupCodes: string[] }> {
  const settings = await prisma.userSettings.findUnique({
    where: { id: "singleton" },
    select: { totpEnabled: true, totpSecret: true },
  });
  if (!settings?.totpEnabled || !settings.totpSecret) throw new Error("2FA is not enabled");
  // A live TOTP code only, never a backup code here - otherwise a single
  // backup code could mint itself an endless supply of replacements
  // without ever proving possession of the authenticator app.
  if (!(await verifyTotpCode(settings.totpSecret, code))) throw new Error("Invalid code");

  const backupCodes = generateBackupCodes();
  const hashed = await hashBackupCodes(backupCodes);
  await prisma.userSettings.update({
    where: { id: "singleton" },
    data: { totpBackupCodes: hashed },
  });
  revalidatePath("/settings");
  return { backupCodes };
}
