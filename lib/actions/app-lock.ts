"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type WebAuthnCredential,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { prisma } from "@/lib/db/prisma";
import { getViewer } from "@/lib/auth-context";

const RP_NAME = "Finalibaba";
// As of v2.0 the WebAuthn user handle is the real user id (it used to be a
// fixed instance-wide constant, back when the app was single-user). WebAuthn
// uses it to namespace resident keys and dedupe registrations for "the same
// user" on one authenticator - so with several users on one instance it has
// to differ per user, or two people registering on the same shared device
// would collide on the authenticator side.
function webAuthnUserId(userId: string): Uint8Array<ArrayBuffer> {
  const bytes = new TextEncoder().encode(userId);
  // Copied into a plain ArrayBuffer-backed view: TextEncoder returns
  // Uint8Array<ArrayBufferLike>, which @simplewebauthn's stricter
  // Uint8Array<ArrayBuffer> parameter type doesn't accept.
  const out = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  out.set(bytes);
  return out;
}

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
  const viewer = await getViewer();
  const [settings, credentials] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: viewer.id },
      select: { appLockEnabled: true },
    }),
    prisma.appLockCredential.findMany({
      where: { userId: viewer.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, deviceLabel: true, createdAt: true, lastUsedAt: true },
    }),
  ]);
  return { enabled: settings.appLockEnabled, credentials };
}

// ── Registration (adding a device) ──────────────────────────────────────────

export async function startAppLockRegistration() {
  const viewer = await getViewer();
  const { rpID } = await getRpConfig();
  const user = await prisma.user.findUnique({
    where: { id: viewer.id },
    select: { username: true, displayName: true },
  });
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: user?.username || user?.displayName || "owner",
    userID: webAuthnUserId(viewer.id),
    attestationType: "none",
    // No excludeCredentials, deliberately.
    //
    // Its only job was to stop the same authenticator being registered twice,
    // which costs a duplicate row the user can see and delete. What it cost
    // instead was a registration that never completed: the list carries no
    // `transports` (they are not stored), so a browser cannot tell whether an
    // excluded credential lives locally or on some other device, and has to
    // go and find out. On a machine with a phone already registered, that is
    // where a second device stopped - reported twice, and not reproducible
    // here even against a production build with a real second authenticator.
    //
    // A visible duplicate is a far better failure than a spinner that never
    // ends, so the exclusion goes. Registering the same device twice simply
    // lists it twice.
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
      // Pinned to the device's OWN authenticator - Touch ID, Windows Hello,
      // the Android biometric. That is what app-lock is: a local unlock for
      // an already-installed PWA, not a portable passkey.
      //
      // Leaving it unset let Chrome offer the cross-device options too (a
      // phone by QR, a security key), and with a phone already registered it
      // sat on that choice indefinitely rather than going straight to Windows
      // Hello - reported as "registering a second device spins forever".
      // It also removes any reason for the browser to look beyond this
      // machine at all.
      authenticatorAttachment: "platform",
    },
    // Explicit rather than left to the library default, so a ceremony the
    // user never completes fails with an error the dialog can show instead of
    // spinning indefinitely. Not a fix for the cross-device chooser above, a
    // floor under it.
    timeout: 60_000,
  });
  // Single reusable slot - see the schema comment on appLockChallenge.
  await prisma.user.update({ where: { id: viewer.id }, data: { appLockChallenge: options.challenge } });
  return options;
}

/**
 * Expected failures are returned with a stable key, not thrown. Production
 * replaces a thrown Server Action error with an opaque digest, so every
 * message below reached the developer console and never the lock screen -
 * which is the one surface in this app whose whole job is to explain why it
 * will not let you in. Same treatment as sync.ts, totp.ts and sharing.ts.
 */
export type AppLockFailure = {
  ok: false;
  error: "no_pending_registration" | "registration_unverified" | "no_pending_auth" | "unknown_device" | "unlock_failed";
};

export async function verifyAppLockRegistration(
  response: RegistrationResponseJSON,
  deviceLabel: string,
): Promise<{ ok: true } | AppLockFailure> {
  const viewer = await getViewer();
  const settings = await prisma.user.findUnique({ where: { id: viewer.id }, select: { appLockChallenge: true } });
  if (!settings?.appLockChallenge) return { ok: false, error: "no_pending_registration" };

  const { rpID, origin } = await getRpConfig();
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: settings.appLockChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });
  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, error: "registration_unverified" };
  }

  const { credential } = verification.registrationInfo;
  await prisma.$transaction([
    prisma.appLockCredential.create({
      data: {
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        deviceLabel: deviceLabel.trim() || "Appareil",
        userId: viewer.id,
      },
    }),
    prisma.user.update({
      where: { id: viewer.id },
      data: { appLockChallenge: null, appLockEnabled: true },
    }),
  ]);
  revalidatePath("/settings");
  return { ok: true as const };
}

// ── Authentication (unlocking) ──────────────────────────────────────────────

export async function startAppLockAuthentication() {
  const viewer = await getViewer();
  const { rpID } = await getRpConfig();
  const credentials = await prisma.appLockCredential.findMany({ where: { userId: viewer.id }, select: { credentialId: true } });
  if (credentials.length === 0) throw new Error("No app-lock device registered");

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: credentials.map((c) => ({ id: c.credentialId })),
    userVerification: "preferred",
  });
  await prisma.user.update({ where: { id: viewer.id }, data: { appLockChallenge: options.challenge } });
  return options;
}

export async function verifyAppLockAuthentication(
  response: AuthenticationResponseJSON,
): Promise<{ ok: true } | AppLockFailure> {
  const viewer = await getViewer();
  const [settings, row] = await Promise.all([
    prisma.user.findUnique({ where: { id: viewer.id }, select: { appLockChallenge: true } }),
    // Scoped to this viewer: an unlock must never be satisfied by another
    // user's registered authenticator on a shared device.
    prisma.appLockCredential.findFirst({ where: { credentialId: response.id, userId: viewer.id } }),
  ]);
  if (!settings?.appLockChallenge) return { ok: false, error: "no_pending_auth" };
  if (!row) return { ok: false, error: "unknown_device" };

  const { rpID, origin } = await getRpConfig();
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: settings.appLockChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: toStoredCredential(row),
  });
  await prisma.user.update({ where: { id: viewer.id }, data: { appLockChallenge: null } });
  if (!verification.verified) return { ok: false, error: "unlock_failed" };

  await prisma.appLockCredential.update({
    where: { id: row.id },
    data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() },
  });
  return { ok: true as const };
}

// ── Management ───────────────────────────────────────────────────────────

// Removing the last remaining device also disables app-lock - a device-less
// "enabled" state would leave the lock screen with nothing to authenticate
// against, an unrecoverable dead end short of shell access to the DB.
export async function removeAppLockCredential(id: string) {
  const viewer = await getViewer();
  await prisma.$transaction(async (tx) => {
    // deleteMany scoped to the viewer, not delete-by-id: a Server Action is
    // directly invocable, so an id alone must never be enough to remove
    // another user's authenticator.
    const { count } = await tx.appLockCredential.deleteMany({ where: { id, userId: viewer.id } });
    if (count === 0) throw new Error("Device not found.");
    const remaining = await tx.appLockCredential.count({ where: { userId: viewer.id } });
    if (remaining === 0) {
      await tx.user.update({ where: { id: viewer.id }, data: { appLockEnabled: false } });
    }
  });
  revalidatePath("/settings");
}

// Turns the lock screen off without deleting registered devices - re-enabling
// later (a fresh registration, since there's no separate "re-enable with
// existing device" flow) starts clean rather than resurrecting stale state.
export async function disableAppLock() {
  const viewer = await getViewer();
  await prisma.user.update({ where: { id: viewer.id }, data: { appLockEnabled: false } });
  revalidatePath("/settings");
}
