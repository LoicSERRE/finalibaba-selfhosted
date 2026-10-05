import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { requireAdminMock } = vi.hoisted(() => ({ requireAdminMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ requireAdmin: requireAdminMock }));

import { refuseBackupRequest } from "@/lib/services/database-backup";

const APP = "https://money.example.com";

function request(headers: Record<string, string>) {
  return new NextRequest(`${APP}/api/backup/download`, { method: "POST", headers });
}

beforeEach(() => {
  requireAdminMock.mockReset().mockResolvedValue({ id: "user-owner", role: "ADMIN" });
  delete process.env.APP_URL;
});

describe("refuseBackupRequest - the gate shared by download and restore", () => {
  it("refuses a foreign origin before the admin check even runs", async () => {
    const res = await refuseBackupRequest(request({ origin: "https://evil.example", host: "money.example.com" }));

    expect(res?.status).toBe(403);
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("refuses a request with no Origin", async () => {
    const res = await refuseBackupRequest(request({ host: "money.example.com" }));
    expect(res?.status).toBe(403);
  });

  it("refuses a same-origin request from a non-admin", async () => {
    requireAdminMock.mockRejectedValue(new Error("Admin access required."));
    const res = await refuseBackupRequest(request({ origin: APP, host: "money.example.com" }));

    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "Admin access required." });
  });

  it("refuses an anonymous request, now that getViewer no longer stands in the owner", async () => {
    requireAdminMock.mockRejectedValue(new Error("Authentication required."));
    const res = await refuseBackupRequest(request({ origin: APP, host: "money.example.com" }));
    expect(res?.status).toBe(403);
  });

  it("lets a same-origin admin through", async () => {
    await expect(refuseBackupRequest(request({ origin: APP, host: "money.example.com" }))).resolves.toBeNull();
  });

  it("applies APP_URL strictly when it is set", async () => {
    process.env.APP_URL = APP;
    const res = await refuseBackupRequest(request({ origin: "https://rebind.example", host: "rebind.example" }));
    expect(res?.status).toBe(403);
  });
});
