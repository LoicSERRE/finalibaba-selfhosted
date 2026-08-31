import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generate as generateTotpToken } from "otplib";

// Light coverage only, per this project's stated lib/actions/* boundary
// (see sonar-project.properties' sonar.coverage.exclusions comment) - error
// paths and the success data shape, not startTotpSetup's QR generation.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { findUniqueMock, updateMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
}));

// TOTP lives on the User row as of v2.0 (per-user 2FA), not the old
// UserSettings singleton.
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: {
      findUnique: findUniqueMock,
      update: updateMock,
      upsert: vi.fn(),
    },
  },
}));

// These actions resolve the current user first; in mono mode that's the
// instance owner, which is what the mocked rows below stand in for.
vi.mock("@/lib/auth-context", () => ({
  getViewer: vi.fn(async () => ({ id: "user-owner", role: "ADMIN", isMonoMode: true })),
}));

import { confirmTotpSetup, disableTotp, regenerateBackupCodes } from "@/lib/actions/totp";
import { generateTotpSecret } from "@/lib/domain/totp";

beforeEach(() => {
  findUniqueMock.mockReset();
  updateMock.mockReset().mockResolvedValue({});
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

    expect(result.ok).toBe(true);
    expect(result.ok && result.backupCodes).toHaveLength(8);
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

    expect(result.ok).toBe(true);
    expect(result.ok && result.backupCodes).toHaveLength(8);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });
});
