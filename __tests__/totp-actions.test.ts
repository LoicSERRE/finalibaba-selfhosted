import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generate as generateTotpToken } from "otplib";

// Light coverage only, per this project's stated lib/actions/* boundary
// (see sonar-project.properties' sonar.coverage.exclusions comment) - error
// paths and the success data shape, not startTotpSetup's QR generation.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { findUniqueMock, updateMock, updateManyMock, lastStep } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
  // The conditional write that spends a code (lib/services/two-factor.ts):
  // a step at or under the last accepted one is refused.
  updateManyMock: vi.fn(),
  lastStep: { value: null as number | null },
}));

// TOTP lives on the User row as of v2.0 (per-user 2FA), not the old
// UserSettings singleton.
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: {
      findUnique: findUniqueMock,
      update: updateMock,
      updateMany: updateManyMock,
      upsert: vi.fn(),
    },
  },
}));

// These actions resolve the current user first; in mono mode that's the
// instance owner, which is what the mocked rows below stand in for.
// getViewer is the policy-checked one; the enrolment actions use the other,
// and the policy test below makes the two disagree to tell them apart.
const { getViewerMock } = vi.hoisted(() => ({ getViewerMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({
  getViewer: getViewerMock,
  getViewerForTwoFactorSetup: vi.fn(async () => ({ id: "user-owner", role: "ADMIN", isMonoMode: true })),
}));

import { confirmTotpSetup, disableTotp, regenerateBackupCodes, startTotpSetup } from "@/lib/actions/totp";
import { generateTotpSecret } from "@/lib/domain/totp";

beforeEach(() => {
  getViewerMock.mockReset().mockResolvedValue({ id: "user-owner", role: "ADMIN", isMonoMode: true });
  findUniqueMock.mockReset();
  updateMock.mockReset().mockResolvedValue({});
  lastStep.value = null;
  updateManyMock.mockReset().mockImplementation(
    async ({ where, data }: { where: { OR?: [unknown, { totpLastStep: { lt: number } }] }; data: { totpLastStep?: number } }) => {
      if (where.OR && lastStep.value !== null && lastStep.value >= where.OR[1].totpLastStep.lt) return { count: 0 };
      if (data.totpLastStep !== undefined) lastStep.value = data.totpLastStep;
      return { count: 1 };
    },
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("confirmTotpSetup", () => {
  // These failures are RETURNED, not thrown: Next replaces a thrown Server
  // Action error with an opaque digest in production, so the reason never
  // reached the user. A real report of "2FA does not work at all" was exactly
  // that, with no way to tell a wrong code from a broken flow.
  it("reports no pending setup instead of throwing", async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    await expect(confirmTotpSetup("123456")).resolves.toEqual({ ok: false, error: "no_pending_setup" });
  });

  it("reports a wrong code and does not enable 2FA", async () => {
    const secret = generateTotpSecret();
    findUniqueMock.mockResolvedValueOnce({ totpSecret: secret });
    await expect(confirmTotpSetup("000000")).resolves.toEqual({ ok: false, error: "invalid_code" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("enables 2FA and returns 8 backup codes on a correct code", async () => {
    const secret = generateTotpSecret();
    const token = await generateTotpToken({ secret });
    findUniqueMock.mockResolvedValueOnce({ totpSecret: secret });

    const result = await confirmTotpSetup(token);

    if (!result.ok) throw new Error("expected the TOTP call to succeed");
    expect(result.backupCodes).toHaveLength(8);
    expect(updateMock).toHaveBeenCalledTimes(1);
    const call = updateMock.mock.calls[0][0];
    expect(call.where).toEqual({ id: "user-owner" });
    expect(call.data.totpEnabled).toBe(true);
    expect(call.data.totpBackupCodes).toHaveLength(8);
  });
});

describe("disableTotp", () => {
  it("reports that 2FA is not enabled instead of throwing", async () => {
    findUniqueMock.mockResolvedValueOnce({ totpEnabled: false, totpSecret: null, totpBackupCodes: [] });
    await expect(disableTotp("123456")).resolves.toEqual({ ok: false, error: "not_enabled" });
  });

  it("reports a wrong code and does not clear anything", async () => {
    const secret = generateTotpSecret();
    findUniqueMock.mockResolvedValueOnce({ totpEnabled: true, totpSecret: secret, totpBackupCodes: [] });
    await expect(disableTotp("000000")).resolves.toEqual({ ok: false, error: "invalid_code" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("clears totpEnabled/totpSecret/totpBackupCodes on a correct code", async () => {
    const secret = generateTotpSecret();
    const token = await generateTotpToken({ secret });
    findUniqueMock.mockResolvedValueOnce({ totpEnabled: true, totpSecret: secret, totpBackupCodes: [] });

    await disableTotp(token);

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "user-owner" },
      data: { totpEnabled: false, totpSecret: null, totpBackupCodes: [] },
    });
  });
});

describe("regenerateBackupCodes", () => {
  it("reports that 2FA is not enabled instead of throwing", async () => {
    findUniqueMock.mockResolvedValueOnce({ totpEnabled: false, totpSecret: null });
    await expect(regenerateBackupCodes("123456")).resolves.toEqual({ ok: false, error: "not_enabled" });
  });

  it("returns 8 new codes on a correct live TOTP code", async () => {
    const secret = generateTotpSecret();
    const token = await generateTotpToken({ secret });
    findUniqueMock.mockResolvedValueOnce({ totpEnabled: true, totpSecret: secret });

    const result = await regenerateBackupCodes(token);

    if (!result.ok) throw new Error("expected the TOTP call to succeed");
    expect(result.backupCodes).toHaveLength(8);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a code already spent - at login or by an earlier call", async () => {
    const secret = generateTotpSecret();
    const token = await generateTotpToken({ secret });
    findUniqueMock.mockResolvedValue({ totpEnabled: true, totpSecret: secret });
    await expect(regenerateBackupCodes(token)).resolves.toMatchObject({ ok: true });
    await expect(regenerateBackupCodes(token)).resolves.toEqual({ ok: false, error: "invalid_code" });
    expect(updateMock).toHaveBeenCalledTimes(1);
  });
});

describe("startTotpSetup", () => {
  it("refuses to re-arm an already-enabled 2FA (would replace the live secret without a code)", async () => {
    findUniqueMock.mockResolvedValue({ totpEnabled: true });

    const result = await startTotpSetup();

    expect(result).toEqual({ ok: false, error: "already_enabled" });
    // The new secret is never written over the live one.
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("starts a fresh setup when 2FA is off", async () => {
    findUniqueMock.mockResolvedValueOnce({ totpEnabled: false }); // the enabled-check read
    findUniqueMock.mockResolvedValueOnce({ username: "alice", displayName: "Alice" }); // the label read

    const result = await startTotpSetup();

    expect("ok" in result).toBe(false);
    expect(updateMock).toHaveBeenCalledWith(
      // A new secret starts with no code spent.
      expect.objectContaining({ data: expect.objectContaining({ totpEnabled: false, totpLastStep: null }) })
    );
  });
});

describe("under the instance 2FA policy", () => {
  // getViewer refuses a user who has not enrolled yet. The two enrolment
  // actions must not, or the policy is a dead end; the two that need 2FA
  // already on must, as any other action does.
  beforeEach(() => {
    getViewerMock.mockRejectedValue(new Error("two-factor enrollment required"));
  });

  it("still lets an unenrolled user start and confirm the setup", async () => {
    findUniqueMock.mockResolvedValueOnce({ totpEnabled: false });
    findUniqueMock.mockResolvedValueOnce({ username: "alice", displayName: "Alice" });
    const started = await startTotpSetup();
    expect("ok" in started).toBe(false);

    findUniqueMock.mockResolvedValueOnce({ totpSecret: null });
    await expect(confirmTotpSetup("123456")).resolves.toEqual({ ok: false, error: "no_pending_setup" });
  });

  it("keeps disabling and regenerating behind the normal check", async () => {
    await expect(disableTotp("123456")).rejects.toThrow(/two-factor/);
    await expect(regenerateBackupCodes("123456")).rejects.toThrow(/two-factor/);
  });
});
