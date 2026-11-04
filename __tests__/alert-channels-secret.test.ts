import { beforeEach, describe, expect, it, vi } from "vitest";

// Middle link of the audited exfiltration chain (F20): a ciphertext leaked
// from one field/user could be POSTed back as the attacker's own channel
// secret and then decrypted server-side and sent to their endpoint. The action
// must refuse an already-encrypted input and treat blank as "leave unchanged",
// so only genuine plaintext is ever (re-)encrypted.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { upsertMock } = vi.hoisted(() => ({ upsertMock: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { userSettings: { upsert: upsertMock } } }));
vi.mock("@/lib/auth-context", () => ({
  getViewer: vi.fn(async () => ({ id: "user-owner", role: "ADMIN", isMonoMode: true })),
}));

import { updateAlertChannels } from "@/lib/actions/alerts";
import { isEncrypted, decryptSecret } from "@/lib/domain/crypto-at-rest";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-channel-encryption-000000";
  upsertMock.mockReset().mockResolvedValue({});
});

/** The update payload the upsert actually wrote. */
function written() {
  return upsertMock.mock.calls[0][0].update as Record<string, unknown>;
}

describe("updateAlertChannels secret handling", () => {
  it("encrypts a genuine new plaintext token", async () => {
    await updateAlertChannels(form({ ntfyAuthToken: "tk_real", smtpPassword: "hunter2" }));
    const u = written();
    expect(isEncrypted(u.ntfyAuthToken as string)).toBe(true);
    expect(decryptSecret(u.ntfyAuthToken as string)).toBe("tk_real");
    expect(decryptSecret(u.smtpPassword as string)).toBe("hunter2");
  });

  it("refuses an already-encrypted input - a replayed ciphertext is never adopted", async () => {
    // What F18/F19 would have handed an attacker: someone else's ciphertext.
    const stolen = "enc:v1:AAAAAAAAAAAAAAAA:ZZZZZZZZZZZZZZZZZZZZZZ";
    await updateAlertChannels(form({ ntfyAuthToken: stolen, smtpPassword: stolen }));
    const u = written();
    // Neither secret is written at all: a blank/ciphertext input means "keep".
    expect(u).not.toHaveProperty("ntfyAuthToken");
    expect(u).not.toHaveProperty("smtpPassword");
  });

  it("treats a blank field as 'leave unchanged', never clearing the stored secret", async () => {
    await updateAlertChannels(form({ ntfyAuthToken: "", smtpPassword: "" }));
    const u = written();
    expect(u).not.toHaveProperty("ntfyAuthToken");
    expect(u).not.toHaveProperty("smtpPassword");
  });
});
