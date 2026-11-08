import { beforeEach, describe, expect, it, vi } from "vitest";

// The instance's mail server is the admin's to set; a user only chooses to
// send through it, and that choice must never carry an SMTP host of theirs.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { userUpsert, instanceUpsert, instanceFind, viewer } = vi.hoisted(() => ({
  userUpsert: vi.fn(),
  instanceUpsert: vi.fn(),
  instanceFind: vi.fn(),
  viewer: { id: "user-member", role: "MEMBER" as "ADMIN" | "MEMBER" },
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    userSettings: { upsert: userUpsert },
    instanceSettings: { upsert: instanceUpsert, findUnique: instanceFind },
  },
}));
vi.mock("@/lib/auth-context", () => ({
  getViewer: vi.fn(async () => viewer),
  requireAdmin: vi.fn(async () => {
    if (viewer.role !== "ADMIN") throw new Error("Forbidden");
    return viewer;
  }),
}));

import { setInstanceMail, updateAlertChannels } from "@/lib/actions/alerts";
import { instanceMailAvailable, instanceMailForm, instanceMailTransport } from "@/lib/services/instance-mail";
import { decryptSecret, encryptSecret, isEncrypted } from "@/lib/domain/crypto-at-rest";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const smtpFields = { smtpHost: "mail", smtpPort: "25", smtpUser: "u", smtpPassword: "p", smtpFrom: "a@example.com" };

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-instance-mail-0000000000";
  viewer.role = "MEMBER";
  userUpsert.mockReset().mockResolvedValue({});
  instanceUpsert.mockReset().mockResolvedValue({});
  instanceFind.mockReset().mockResolvedValue(null);
});

describe("updateAlertChannels with the instance's server", () => {
  it("records the choice and writes no SMTP field, whatever the form carries", async () => {
    await updateAlertChannels(form({ useInstanceMail: "on", alertEmailTo: "me@example.com", ...smtpFields }));
    const update = userUpsert.mock.calls[0][0].update as Record<string, unknown>;
    expect(update.useInstanceMail).toBe(true);
    expect(update.alertEmailTo).toBe("me@example.com");
    for (const column of ["smtpHost", "smtpPort", "smtpUser", "smtpPassword", "smtpFrom"]) {
      expect(update).not.toHaveProperty(column);
    }
  });

  it("writes the user's own SMTP fields when they choose another provider", async () => {
    await updateAlertChannels(form(smtpFields));
    const update = userUpsert.mock.calls[0][0].update as Record<string, unknown>;
    expect(update.useInstanceMail).toBe(false);
    expect(update.smtpHost).toBe("mail");
    expect(decryptSecret(update.smtpPassword as string)).toBe("p");
  });
});

describe("setInstanceMail", () => {
  it("refuses a member, writing nothing", async () => {
    await expect(setInstanceMail(form(smtpFields))).rejects.toThrow("Forbidden");
    expect(instanceUpsert).not.toHaveBeenCalled();
  });

  it("saves an admin's server, its password encrypted", async () => {
    viewer.role = "ADMIN";
    const result = await setInstanceMail(form(smtpFields));
    expect(result).toEqual({ ok: true, data: { configured: true } });
    const update = instanceUpsert.mock.calls[0][0].update as Record<string, unknown>;
    expect(update).toMatchObject({ smtpHost: "mail", smtpPort: 25, smtpUser: "u", smtpFrom: "a@example.com" });
    expect(isEncrypted(update.smtpPassword as string)).toBe(true);
    expect(decryptSecret(update.smtpPassword as string)).toBe("p");
  });

  it("keeps the stored password when the field is blank", async () => {
    viewer.role = "ADMIN";
    await setInstanceMail(form({ ...smtpFields, smtpPassword: "" }));
    expect(instanceUpsert.mock.calls[0][0].update).not.toHaveProperty("smtpPassword");
  });

  it("drops a port out of range, and says the server is then incomplete", async () => {
    viewer.role = "ADMIN";
    const result = await setInstanceMail(form({ ...smtpFields, smtpPort: "70000" }));
    expect(result).toEqual({ ok: true, data: { configured: false } });
    expect(instanceUpsert.mock.calls[0][0].update.smtpPort).toBeNull();
  });
});

describe("reading the instance's server", () => {
  const row = { smtpHost: "mail", smtpPort: 25, smtpUser: null, smtpPassword: null, smtpFrom: "a@example.com" };

  it("offers nothing until host, port and sender are all set", async () => {
    for (const missing of ["smtpHost", "smtpPort", "smtpFrom"]) {
      instanceFind.mockResolvedValue({ ...row, [missing]: null });
      expect(await instanceMailAvailable()).toBe(false);
      expect(await instanceMailTransport()).toBeNull();
    }
    instanceFind.mockResolvedValue(row);
    expect(await instanceMailAvailable()).toBe(true);
  });

  it("decrypts the password for a send, and never hands it to the form", async () => {
    instanceFind.mockResolvedValue({ ...row, smtpPassword: encryptSecret("secret") });
    expect((await instanceMailTransport())?.password).toBe("secret");
    const shown = await instanceMailForm();
    expect(shown).not.toHaveProperty("password");
    expect(shown.hasPassword).toBe(true);
  });
});
