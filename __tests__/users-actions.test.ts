import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/actions/users.ts holds every credential-handling path in the app:
// bootstrap, invitation redemption, user deletion, password change. The
// post-v2.0 release-boundary audit found it had zero coverage - it sits inside
// the wholesale lib/actions/* Sonar exclusion, so nothing complained, and it
// had only ever been verified live.
//
// Same mocked-Prisma boundary as the other action tests here. What's asserted
// is the set of invariants a bug would breach silently: bootstrap only ever
// UPDATEs the pre-existing owner row (never creates a second user, which is
// what makes "your existing data will be attached to this account" literally
// true), an invitation is single-use and always MEMBER, and the owner can
// never be deleted.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const {
  userFindUniqueMock,
  userFindUniqueOrThrowMock,
  userUpdateMock,
  userCreateMock,
  userDeleteMock,
  userFindManyMock,
  invitationFindUniqueMock,
  invitationCreateMock,
  invitationUpdateMock,
  invitationDeleteMock,
  invitationFindManyMock,
  transactionMock,
  getViewerMock,
  requireAdminMock,
  isAuthEnabledMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  userFindUniqueOrThrowMock: vi.fn(),
  userUpdateMock: vi.fn(),
  userCreateMock: vi.fn(),
  userDeleteMock: vi.fn(),
  userFindManyMock: vi.fn(),
  invitationFindUniqueMock: vi.fn(),
  invitationCreateMock: vi.fn(),
  invitationUpdateMock: vi.fn(),
  invitationDeleteMock: vi.fn(),
  invitationFindManyMock: vi.fn(),
  transactionMock: vi.fn(),
  getViewerMock: vi.fn(),
  requireAdminMock: vi.fn(),
  isAuthEnabledMock: vi.fn(() => true),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: {
      findUnique: userFindUniqueMock,
      findUniqueOrThrow: userFindUniqueOrThrowMock,
      update: userUpdateMock,
      create: userCreateMock,
      delete: userDeleteMock,
      findMany: userFindManyMock,
    },
    invitation: {
      findUnique: invitationFindUniqueMock,
      create: invitationCreateMock,
      update: invitationUpdateMock,
      delete: invitationDeleteMock,
      findMany: invitationFindManyMock,
    },
    $transaction: transactionMock,
  },
}));

vi.mock("@/lib/auth-context", async () => {
  const { OWNER_USER_ID } = await vi.importActual<typeof import("@/lib/domain/users")>(
    "@/lib/domain/users"
  );
  return {
    OWNER_USER_ID,
    getViewer: getViewerMock,
    requireAdmin: requireAdminMock,
    isAuthEnabled: isAuthEnabledMock,
  };
});

import {
  needsBootstrap,
  bootstrapOwner,
  acceptInvitation,
  isInvitationValid,
  deleteUser,
  changeOwnPassword,
  createInvitation,
} from "@/lib/actions/users";
import { OWNER_USER_ID } from "@/lib/domain/users";

const ADMIN = { id: OWNER_USER_ID, role: "ADMIN" as const, isMonoMode: false };

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  for (const m of [
    userFindUniqueMock,
    userFindUniqueOrThrowMock,
    userUpdateMock,
    userCreateMock,
    userDeleteMock,
    userFindManyMock,
    invitationFindUniqueMock,
    invitationCreateMock,
    invitationUpdateMock,
    invitationDeleteMock,
    invitationFindManyMock,
    transactionMock,
    getViewerMock,
    requireAdminMock,
  ]) {
    m.mockReset();
  }
  isAuthEnabledMock.mockReturnValue(true);
  getViewerMock.mockResolvedValue(ADMIN);
  requireAdminMock.mockResolvedValue(ADMIN);
  userUpdateMock.mockResolvedValue({});
  delete process.env.AUTH_PASSWORD;
  delete process.env.AUTH_PASSWORD_HASH;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.AUTH_PASSWORD;
  delete process.env.AUTH_PASSWORD_HASH;
});

describe("needsBootstrap", () => {
  it("is false when auth is off - mono mode has nothing to bootstrap", async () => {
    isAuthEnabledMock.mockReturnValue(false);
    await expect(needsBootstrap()).resolves.toBe(false);
  });

  it("is false when an env password still applies", async () => {
    process.env.AUTH_PASSWORD = "from-env";
    await expect(needsBootstrap()).resolves.toBe(false);
    // Short-circuits before touching the database at all.
    expect(userFindUniqueMock).not.toHaveBeenCalled();
  });

  it("is true when auth is on and the owner has no way to log in", async () => {
    userFindUniqueMock.mockResolvedValue({ passwordHash: null });
    await expect(needsBootstrap()).resolves.toBe(true);
  });

  it("is false once the owner has a DB password", async () => {
    userFindUniqueMock.mockResolvedValue({ passwordHash: "$2b$10$hash" });
    await expect(needsBootstrap()).resolves.toBe(false);
  });
});

describe("bootstrapOwner", () => {
  it("UPDATEs the existing owner row and never creates a second user", async () => {
    // This is what makes "your existing data will be attached to this account"
    // literally true: every pre-v2 row already points at the owner, so setting
    // credentials is an UPDATE, not a data migration that could half-fail.
    userFindUniqueMock.mockResolvedValue({ passwordHash: null });

    await bootstrapOwner(form({ username: "Alice", password: "longenough1" }));

    expect(userCreateMock).not.toHaveBeenCalled();
    expect(userUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: OWNER_USER_ID } })
    );
    const data = userUpdateMock.mock.calls[0][0].data;
    expect(data.username).toBe("alice"); // normalized
    expect(data.displayName).toBe("Alice"); // as typed
    expect(data.role).toBe("ADMIN");
    expect(data.passwordHash).not.toBe("longenough1"); // hashed, never stored raw
  });

  it("refuses once the instance is already set up", async () => {
    userFindUniqueMock.mockResolvedValue({ passwordHash: "$2b$10$hash" });

    await expect(bootstrapOwner(form({ username: "mallory", password: "longenough1" }))).rejects.toThrow(
      "Already set up."
    );
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects credentials that fail validation", async () => {
    userFindUniqueMock.mockResolvedValue({ passwordHash: null });

    await expect(bootstrapOwner(form({ username: "ab", password: "longenough1" }))).rejects.toThrow();
    await expect(bootstrapOwner(form({ username: "alice", password: "short" }))).rejects.toThrow();
    expect(userUpdateMock).not.toHaveBeenCalled();
  });
});

describe("acceptInvitation", () => {
  /** Runs the callback against a tx client exposing the same mocks. */
  const runTransaction = () =>
    transactionMock.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          invitation: { findUnique: invitationFindUniqueMock, update: invitationUpdateMock },
          user: { create: userCreateMock },
        })
    );

  it("creates a MEMBER and consumes the token in the same transaction", async () => {
    runTransaction();
    invitationFindUniqueMock.mockResolvedValue({
      id: "inv-1",
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    userCreateMock.mockResolvedValue({});
    invitationUpdateMock.mockResolvedValue({});

    await acceptInvitation("tok", form({ username: "Bob", password: "longenough1" }));

    // Never ADMIN: an invitation must not be able to mint a second admin.
    expect(userCreateMock.mock.calls[0][0].data.role).toBe("MEMBER");
    expect(userCreateMock.mock.calls[0][0].data.username).toBe("bob");
    expect(invitationUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "inv-1" } })
    );
    // Both writes go through one $transaction, so a link opened twice at once
    // cannot mint two accounts.
    expect(transactionMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["unknown", null],
    ["already used", { id: "i", usedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }],
    ["expired", { id: "i", usedAt: null, expiresAt: new Date(Date.now() - 60_000) }],
  ])("rejects an %s invitation without creating anyone", async (_label, invitation) => {
    runTransaction();
    invitationFindUniqueMock.mockResolvedValue(invitation);

    await expect(
      acceptInvitation("tok", form({ username: "bob", password: "longenough1" }))
    ).rejects.toThrow("invalid_invitation");
    expect(userCreateMock).not.toHaveBeenCalled();
  });

  it("validates the credentials before touching the invitation", async () => {
    await expect(acceptInvitation("tok", form({ username: "b", password: "x" }))).rejects.toThrow();
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("isInvitationValid", () => {
  it.each([
    ["valid", { usedAt: null, expiresAt: new Date(Date.now() + 60_000) }, true],
    ["used", { usedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }, false],
    ["expired", { usedAt: null, expiresAt: new Date(Date.now() - 60_000) }, false],
    ["unknown", null, false],
  ])("%s -> %s", async (_label, row, expected) => {
    invitationFindUniqueMock.mockResolvedValue(row);
    await expect(isInvitationValid("tok")).resolves.toBe(expected);
  });
});

describe("deleteUser", () => {
  it("refuses to delete the instance owner", async () => {
    // Every row the Python sync sidecar writes defaults to this id, so
    // removing it would break sync at the FK level.
    await expect(deleteUser(OWNER_USER_ID)).rejects.toThrow(/owner cannot be deleted/i);
    expect(userDeleteMock).not.toHaveBeenCalled();
  });

  it("refuses to delete yourself", async () => {
    requireAdminMock.mockResolvedValue({ id: "admin-2", role: "ADMIN", isMonoMode: false });

    await expect(deleteUser("admin-2")).rejects.toThrow(/your own account/i);
    expect(userDeleteMock).not.toHaveBeenCalled();
  });

  it("requires admin", async () => {
    requireAdminMock.mockRejectedValue(new Error("Admin access required."));

    await expect(deleteUser("user-b")).rejects.toThrow("Admin access required.");
    expect(userDeleteMock).not.toHaveBeenCalled();
  });

  it("deletes anyone else", async () => {
    userDeleteMock.mockResolvedValue({});
    await deleteUser("user-b");
    expect(userDeleteMock).toHaveBeenCalledWith({ where: { id: "user-b" } });
  });
});

describe("createInvitation", () => {
  it("requires admin and mints a high-entropy token", async () => {
    invitationCreateMock.mockResolvedValue({});
    const { token } = await createInvitation();

    expect(requireAdminMock).toHaveBeenCalled();
    // 32 random bytes, base64url - same generation shape as ShareLink/ApiKey.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(invitationCreateMock.mock.calls[0][0].data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("propagates the admin check", async () => {
    requireAdminMock.mockRejectedValue(new Error("Admin access required."));
    await expect(createInvitation()).rejects.toThrow("Admin access required.");
    expect(invitationCreateMock).not.toHaveBeenCalled();
  });
});

// Failures are RETURNED, not thrown. Next replaces a thrown Server Action
// error with an opaque digest in production, so the keys this form maps to
// translated sentences never actually arrived - "wrong current password" was
// only ever visible in development.
describe("changeOwnPassword", () => {
  it("refuses in mono mode - there is no password to change", async () => {
    getViewerMock.mockResolvedValue({ ...ADMIN, isMonoMode: true });

    await expect(
      changeOwnPassword(form({ currentPassword: "x", newPassword: "longenough1" }))
    ).resolves.toEqual({ ok: false, error: "auth_disabled" });
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a wrong current password", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    userFindUniqueOrThrowMock.mockResolvedValue({ username: "owner", passwordHash: await bcrypt.hash("realpass", 4) });

    await expect(
      changeOwnPassword(form({ currentPassword: "wrong", newPassword: "longenough1" }))
    ).resolves.toEqual({ ok: false, error: "invalid_current_password" });
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("accepts the right current password and stores a hash, not the value", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    userFindUniqueOrThrowMock.mockResolvedValue({ username: "owner", passwordHash: await bcrypt.hash("realpass", 4) });

    await changeOwnPassword(form({ currentPassword: "realpass", newPassword: "longenough1" }));

    const data = userUpdateMock.mock.calls[0][0].data;
    expect(data.passwordHash).not.toBe("longenough1");
    expect(await bcrypt.compare("longenough1", data.passwordHash)).toBe(true);
  });

  it("lets a user still on the env password set their first DB one", async () => {
    // The owner pre-bootstrap has no hash to check against; setting one here
    // is what makes the env credential stop applying to them (see resolveUser).
    userFindUniqueOrThrowMock.mockResolvedValue({ username: null, passwordHash: null });

    await changeOwnPassword(
      form({ currentPassword: "", newPassword: "longenough1", username: "Loic" }),
    );

    const data = userUpdateMock.mock.calls[0][0].data;
    // Claiming a username is part of the same step: an owner who only ever had
    // the env password has no account row to be attributed to otherwise.
    expect(data.username).toBe("loic");
    expect(data.displayName).toBe("Loic");
    expect(data.passwordHash).toBeTruthy();
  });

  it("refuses to leave an env-password owner without a username", async () => {
    // Setting only a password there would produce an account that can log in
    // but cannot be named, invited by, or listed - the state this whole flow
    // exists to get out of.
    userFindUniqueOrThrowMock.mockResolvedValue({ username: null, passwordHash: null });

    await expect(
      changeOwnPassword(form({ currentPassword: "", newPassword: "longenough1" })),
    ).resolves.toEqual({ ok: false, error: "username_required" });
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("does not let an established user rename themselves through this form", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    userFindUniqueOrThrowMock.mockResolvedValue({ username: "owner", passwordHash: await bcrypt.hash("realpass", 4) });

    await changeOwnPassword(
      form({ currentPassword: "realpass", newPassword: "longenough1", username: "someoneelse" }),
    );

    expect(userUpdateMock.mock.calls[0][0].data.username).toBeUndefined();
  });

  it("rejects a new password that fails validation, with the reason attached", async () => {
    // The user row has to be mocked here. Without it this test used to pass
    // on a TypeError from the unmocked findUniqueOrThrow rather than on the
    // validation it claims to check - `rejects.toThrow()` with no argument
    // accepts any throw at all, which is exactly how that stayed hidden.
    const bcrypt = (await import("bcryptjs")).default;
    userFindUniqueOrThrowMock.mockResolvedValue({
      username: "owner",
      passwordHash: await bcrypt.hash("realpass", 4),
    });

    const result = await changeOwnPassword(
      form({ currentPassword: "realpass", newPassword: "short" }),
    );
    // The validator's message is already written for a human, so it rides
    // along rather than being flattened into one generic key.
    // A guard rather than a second assertion: it narrows the union so the
    // check below is about `detail` alone, and a failure names which half
    // went wrong instead of collapsing both into one falsy value.
    if (result.ok) throw new Error("expected changeOwnPassword to fail");
    expect(result.error).toBe("invalid_current_password");
    expect(result.detail).toBeTruthy();
    expect(userUpdateMock).not.toHaveBeenCalled();
  });
});
