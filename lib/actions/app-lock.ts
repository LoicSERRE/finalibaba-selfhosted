"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { prisma } from "@/lib/db/prisma";

const RP_NAME = "Finalibaba";
// Fixed, stable across every registration - this is a single-user app (see
// CLAUDE.md's v2.0 multi-user note), so there's no real per-account user id
// to derive this from. WebAuthn only uses it to namespace resident keys and
// dedupe registrations for "the same user" on one authenticator - a fixed
// value is exactly correct here, not a shortcut.
const USER_ID = new TextEncoder().encode("finalibaba-singleton-user");

// Same fallback precedent as app/api/gocardless/connect/route.ts's own
// `process.env.APP_URL ?? \`${req.nextUrl.protocol}//${req.nextUrl.host}\``
// - prefer the configured public URL when set (reverse-proxy deployments),
// otherwise derive rpID/origin from the actual incoming request. A Server
// Action has no `req` object to read though, so this reads the `host`/
// `x-forwarded-proto` headers instead. WebAuthn's rpID must exactly match
// the domain the browser used to reach the app, or every ceremony fails -
// there's no way to get this right from a static env var alone for an
// instance reached via localhost, a bare LAN IP, and a real domain behind
// a proxy, all without extra config.
async function getRpConfig(): Promise<{ rpID: string; origin: string }> {
  if (process.env.APP_URL) {
    const url = new URL(process.env.APP_URL);
    return { rpID: url.hostname, origin: url.origin };
  }
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const hostname = host.split(":")[0];
  const proto = h.get("x-forwarded-proto") ?? (hostname === "localhost" || hostname === "127.0.0.1" ? "http" : "https");
  return { rpID: hostname, origin: `${proto}://${host}` };
}

function toStoredCredential(row: { credentialId: string; publicKey: Uint8Array; counter: number }): WebAuthnCredential {
  return { id: row.credentialId, publicKey: new Uint8Array(row.publicKey), counter: row.counter };
}

export async function getAppLockStatus() {
  const [settings, credentials] = await Promise.all([
    prisma.userSettings.upsert({
      where: { id: "singleton" },
      create: {},
      update: {},
      select: { appLockEnabled: true },
    }),
    prisma.appLockCredential.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, deviceLabel: true, createdAt: true, lastUsedAt: true },
    }),
  ]);
  return { enabled: settings.appLockEnabled, credentials };
}

// ── Registration (adding a device) ──────────────────────────────────────────

export async function startAppLockRegistration() {
  const { rpID } = await getRpConfig();
  const existing = await prisma.appLockCredential.findMany({ select: { credentialId: true } });
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: "owner",
    userID: USER_ID,
    attestationType: "none",
    // Excludes already-registered devices from being re-registered as a
    // second credential for the same authenticator.
    excludeCredentials: existing.map((c) => ({ id: c.credentialId })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  // Single reusable slot - see the schema comment on appLockChallenge.
  await prisma.userSettings.update({ where: { id: "singleton" }, data: { appLockChallenge: options.challenge } });
  return options;
}

export async function verifyAppLockRegistration(response: RegistrationResponseJSON, deviceLabel: string) {
  const settings = await prisma.userSettings.findUnique({ where: { id: "singleton" }, select: { appLockChallenge: true } });
  if (!settings?.appLockChallenge) throw new Error("No pending app-lock registration");

  const { rpID, origin } = await getRpConfig();
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: settings.appLockChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });
  if (!verification.verified || !verification.registrationInfo) throw new Error("Registration could not be verified");

  const { credential } = verification.registrationInfo;
  await prisma.$transaction([
    prisma.appLockCredential.create({
      data: {
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        deviceLabel: deviceLabel.trim() || "Appareil",
      },
    }),
    prisma.userSettings.update({
      where: { id: "singleton" },
      data: { appLockChallenge: null, appLockEnabled: true },
    }),
  ]);
  revalidatePath("/settings");
}

// ── Authentication (unlocking) ──────────────────────────────────────────────

export async function startAppLockAuthentication() {
  const { rpID } = await getRpConfig();
  const credentials = await prisma.appLockCredential.findMany({ select: { credentialId: true } });
  if (credentials.length === 0) throw new Error("No app-lock device registered");

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: credentials.map((c) => ({ id: c.credentialId })),
    userVerification: "preferred",
  });
  await prisma.userSettings.update({ where: { id: "singleton" }, data: { appLockChallenge: options.challenge } });
  return options;
}

export async function verifyAppLockAuthentication(response: AuthenticationResponseJSON) {
  const [settings, row] = await Promise.all([
    prisma.userSettings.findUnique({ where: { id: "singleton" }, select: { appLockChallenge: true } }),
    prisma.appLockCredential.findUnique({ where: { credentialId: response.id } }),
  ]);
  if (!settings?.appLockChallenge) throw new Error("No pending app-lock authentication");
  if (!row) throw new Error("Unknown app-lock device");

  const { rpID, origin } = await getRpConfig();
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: settings.appLockChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: toStoredCredential(row),
  });
  await prisma.userSettings.update({ where: { id: "singleton" }, data: { appLockChallenge: null } });
  if (!verification.verified) throw new Error("Unlock failed");

  await prisma.appLockCredential.update({
    where: { id: row.id },
    data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() },
  });
  return { verified: true };
}

// ── Management ───────────────────────────────────────────────────────────

// Removing the last remaining device also disables app-lock - a device-less
// "enabled" state would leave the lock screen with nothing to authenticate
// against, an unrecoverable dead end short of shell access to the DB.
export async function removeAppLockCredential(id: string) {
  await prisma.$transaction(async (tx) => {
    await tx.appLockCredential.delete({ where: { id } });
    const remaining = await tx.appLockCredential.count();
    if (remaining === 0) {
      await tx.userSettings.update({ where: { id: "singleton" }, data: { appLockEnabled: false } });
    }
  });
  revalidatePath("/settings");
}

// Turns the lock screen off without deleting registered devices - re-enabling
// later (a fresh registration, since there's no separate "re-enable with
// existing device" flow) starts clean rather than resurrecting stale state.
export async function disableAppLock() {
  await prisma.userSettings.update({ where: { id: "singleton" }, data: { appLockEnabled: false } });
  revalidatePath("/settings");
}
