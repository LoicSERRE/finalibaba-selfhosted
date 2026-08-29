"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { getViewer, requireAdmin, isAuthEnabled, OWNER_USER_ID } from "@/lib/auth-context";
import { normalizeUsername, validateCredentials } from "@/lib/domain/users";

/**
 * User management, bootstrap and invitations (v2.0) - see CLAUDE.md's
 * "Multi-user architecture".
 *
 * The bootstrap flow (first login on an instance that just turned
 * AUTH_ENABLED on) and the invitation flow are deliberately the same shape:
 * "choose your own username and password". The admin never sets anyone else's
 * password - they hand out a single-use link and the invitee sets their own,
 * so the admin never knows it and it never travels through a second channel.
 */

const INVITATION_TTL_MS = 48 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 10;

/**
 * Whether the app must show the "create your admin account" screen: auth is
 * on, but the owner has no way to log in yet and no env password to fall back
 * on. This is the day-180 case - an instance that ran happily in mono mode
 * for months and only now turned auth on. Its data is already attached to the
 * owner row, so this screen only sets credentials; nothing is moved.
 */
export async function needsBootstrap(): Promise<boolean> {
  if (!isAuthEnabled()) return false;
  if (process.env.AUTH_PASSWORD || process.env.AUTH_PASSWORD_HASH) return false;

  const owner = await prisma.user.findUnique({
    where: { id: OWNER_USER_ID },
    select: { passwordHash: true },
  });
  return !owner?.passwordHash;
}

/**
 * True when the owner is still relying on the env password while having no DB
 * account of their own - login works, but user management can't (there's no
 * username to attribute anything to). Settings surfaces a "finish setting up
 * your account" banner on this, rather than forcing an interruption.
 */
export async function ownerNeedsAccountSetup(): Promise<boolean> {
  if (!isAuthEnabled()) return false;
  const owner = await prisma.user.findUnique({
    where: { id: OWNER_USER_ID },
    select: { passwordHash: true, username: true },
  });
  return !owner?.passwordHash || !owner.username;
}

/**
 * Sets credentials on the pre-existing owner row (never creates a second
 * user): every pre-v2 row in the database already points at it, so this is
 * what "your existing data will be attached to this account" actually means -
 * an UPDATE, not a data migration that could half-fail.
 */
export async function bootstrapOwner(formData: FormData): Promise<void> {
  if (!(await needsBootstrap())) throw new Error("Already set up.");

  const rawUsername = (formData.get("username") as string) || "";
  const password = (formData.get("password") as string) || "";
  const check = validateCredentials(rawUsername, password);
  if (!check.ok) throw new Error(check.error);

  await prisma.user.update({
    where: { id: OWNER_USER_ID },
    data: {
      username: normalizeUsername(rawUsername),
      displayName: rawUsername.trim(),
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      role: "ADMIN",
    },
  });
  revalidatePath("/");
}

export async function listUsers() {
  await requireAdmin();
  return prisma.user.findMany({
    select: { id: true, username: true, displayName: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function listInvitations() {
  await requireAdmin();
  return prisma.invitation.findMany({
    where: { usedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, token: true, expiresAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * 256 bits of entropy, same generation shape as ShareLink/ApiKey tokens - an
 * invitation link is a bearer credential reachable from wherever it's pasted,
 * so guessability is the only thing protecting it before it's used.
 */
export async function createInvitation(): Promise<{ token: string }> {
  const admin = await requireAdmin();
  const token = randomBytes(32).toString("base64url");
  await prisma.invitation.create({
    data: {
      token,
      createdByUserId: admin.id,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    },
  });
  revalidatePath("/settings");
  return { token };
}

export async function revokeInvitation(id: string): Promise<void> {
  await requireAdmin();
  await prisma.invitation.delete({ where: { id } });
  revalidatePath("/settings");
}

/** Unauthenticated: called by the /invite/[token] page before any account exists. */
export async function isInvitationValid(token: string): Promise<boolean> {
  const invitation = await prisma.invitation.findUnique({
    where: { token },
    select: { usedAt: true, expiresAt: true },
  });
  return !!invitation && invitation.usedAt === null && invitation.expiresAt > new Date();
}

/**
 * Redeems an invitation into a real account. The token is consumed in the
 * same transaction that creates the user, so a link can never mint two
 * accounts even if it's opened twice at once.
 */
export async function acceptInvitation(token: string, formData: FormData): Promise<void> {
  const rawUsername = (formData.get("username") as string) || "";
  const password = (formData.get("password") as string) || "";
  const check = validateCredentials(rawUsername, password);
  if (!check.ok) throw new Error(check.error);

  const username = normalizeUsername(rawUsername);
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await prisma.$transaction(async (tx) => {
    const invitation = await tx.invitation.findUnique({
      where: { token },
      select: { id: true, usedAt: true, expiresAt: true },
    });
    const spent = invitation?.usedAt !== null;
    const expired = (invitation?.expiresAt ?? new Date(0)) <= new Date();
    if (spent || expired) {
      throw new Error("invalid_invitation");
    }
    await tx.user.create({
      data: { username, displayName: rawUsername.trim(), passwordHash, role: "MEMBER" },
    });
    await tx.invitation.update({ where: { id: invitation.id }, data: { usedAt: new Date() } });
  });
}

/**
 * Deleting a user cascades through everything they own (accounts, and
 * transitively every transaction/holding/balance under them) - the FKs are
 * all onDelete: Cascade. The owner can never be deleted: every row created by
 * the Python sync sidecar defaults to it, so removing it would break every
 * subsequent sync at the FK level.
 */
export async function deleteUser(id: string): Promise<void> {
  const admin = await requireAdmin();
  if (id === OWNER_USER_ID) throw new Error("The instance owner cannot be deleted.");
  if (id === admin.id) throw new Error("You cannot delete your own account.");
  await prisma.user.delete({ where: { id } });
  revalidatePath("/settings");
}

/** Self-service password change for the logged-in user. */
export async function changeOwnPassword(formData: FormData): Promise<void> {
  const viewer = await getViewer();
  if (viewer.isMonoMode) throw new Error("Authentication is disabled on this instance.");

  const current = (formData.get("currentPassword") as string) || "";
  const next = (formData.get("newPassword") as string) || "";
  const check = validateCredentials("placeholder", next);
  if (!check.ok) throw new Error(check.error);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: viewer.id },
    select: { passwordHash: true },
  });
  // A user still on the env password (owner, pre-bootstrap) has no DB hash to
  // check against - they set one here for the first time, after which the env
  // credential stops applying to them entirely (see resolveUser in lib/auth.ts).
  if (user.passwordHash && !(await bcrypt.compare(current, user.passwordHash))) {
    throw new Error("invalid_current_password");
  }

  await prisma.user.update({
    where: { id: viewer.id },
    data: { passwordHash: await bcrypt.hash(next, BCRYPT_ROUNDS) },
  });
  revalidatePath("/settings");
}
