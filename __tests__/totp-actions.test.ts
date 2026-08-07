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

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    userSettings: {
      findUnique: findUniqueMock,
      update: updateMock,
      upsert: vi.fn(),
    },
  },
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
  it("throws when there is no pending setup (no stored secret)", async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    await expect(confirmTotpSetup("123456")).rejects.toThrow("No pending 2FA setup");
  });

  it("throws on a wrong code and does not enable 2FA", async () => {
    const secret = generateTotpSecret();
    findUniqueMock.mockResolvedValueOnce({ totpSecret: secret });
    await expect(confirmTotpSetup("000000")).rejects.toThrow("Invalid code");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("enables 2FA and returns 8 backup codes on a correct code", async () => {
    const secret = generateTotpSecret();
    const token = await generateTotpToken({ secret });
    findUniqueMock.mockResolvedValueOnce({ totpSecret: secret });

    const result = await confirmTotpSetup(token);

    expect(result.backupCodes).toHaveLength(8);
    expect(updateMock).toHaveBeenCalledTimes(1);
    const call = updateMock.mock.calls[0][0];
    expect(call.where).toEqual({ id: "singleton" });
    expect(call.data.totpEnabled).toBe(true);
    expect(call.data.totpBackupCodes).toHaveLength(8);
  });
});

describe("disableTotp", () => {
  it("throws when 2FA is not currently enabled", async () => {
    findUniqueMock.mockResolvedValueOnce({ totpEnabled: false, totpSecret: null, totpBackupCodes: [] });
    await expect(disableTotp("123456")).rejects.toThrow("2FA is not enabled");
  });

  it("throws on a wrong code and does not clear anything", async () => {
    const secret = generateTotpSecret();
    findUniqueMock.mockResolvedValueOnce({ totpEnabled: true, totpSecret: secret, totpBackupCodes: [] });
    await expect(disableTotp("000000")).rejects.toThrow("Invalid code");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("clears totpEnabled/totpSecret/totpBackupCodes on a correct code", async () => {
    const secret = generateTotpSecret();
    const token = await generateTotpToken({ secret });
    findUniqueMock.mockResolvedValueOnce({ totpEnabled: true, totpSecret: secret, totpBackupCodes: [] });

    await disableTotp(token);

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "singleton" },
      data: { totpEnabled: false, totpSecret: null, totpBackupCodes: [] },
    });
  });
});

describe("regenerateBackupCodes", () => {
  it("throws when 2FA is not currently enabled", async () => {
    findUniqueMock.mockResolvedValueOnce({ totpEnabled: false, totpSecret: null });
    await expect(regenerateBackupCodes("123456")).rejects.toThrow("2FA is not enabled");
  });

  it("returns 8 new codes on a correct live TOTP code", async () => {
    const secret = generateTotpSecret();
    const token = await generateTotpToken({ secret });
    findUniqueMock.mockResolvedValueOnce({ totpEnabled: true, totpSecret: secret });

    const result = await regenerateBackupCodes(token);

    expect(result.backupCodes).toHaveLength(8);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });
});
