import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * autoTriggerSync decides whether the "sync in progress" badge appears and
 * polls. It used to answer triggered: true even when the request to the sync
 * service failed, because a .catch(() => {}) swallowed the failure - so any
 * instance whose sync service was down, or absent (a supported setup), showed
 * a phantom badge for two minutes on every page load. Found by the visual
 * audit (scripts/ui-audit), where it covered buttons on every phone page.
 */

const { syncLogFindFirst, institutionFindMany, getViewerMock } = vi.hoisted(() => ({
  syncLogFindFirst: vi.fn(),
  institutionFindMany: vi.fn(),
  getViewerMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    syncLog: { findFirst: syncLogFindFirst },
    institution: { findMany: institutionFindMany },
  },
}));
vi.mock("@/lib/auth-context", async () => {
  const { OWNER_USER_ID } = await vi.importActual<typeof import("@/lib/domain/users")>("@/lib/domain/users");
  return { OWNER_USER_ID, getViewer: getViewerMock, assertOwned: vi.fn() };
});

import { autoTriggerSync } from "@/lib/actions/sync";
import { OWNER_USER_ID } from "@/lib/domain/users";

const fetchMock = vi.fn();

beforeEach(() => {
  syncLogFindFirst.mockReset().mockResolvedValue(null); // stale: never synced
  institutionFindMany.mockReset().mockResolvedValue([]);
  getViewerMock.mockReset().mockResolvedValue({ id: OWNER_USER_ID, role: "ADMIN", isMonoMode: true });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("autoTriggerSync - the owner's .env sync", () => {
  it("reports a sync only when the service accepted it", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    await expect(autoTriggerSync()).resolves.toEqual({ triggered: true });
  });

  it("does not claim a sync when the service is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(autoTriggerSync()).resolves.toEqual({ triggered: false });
  });

  it("does not claim a sync when the service refuses it", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    await expect(autoTriggerSync()).resolves.toEqual({ triggered: false });
  });

  it("does not call the service at all while the last sync is fresh", async () => {
    syncLogFindFirst.mockResolvedValue({ createdAt: new Date() });
    await expect(autoTriggerSync()).resolves.toEqual({ triggered: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("autoTriggerSync - a member's own banks", () => {
  beforeEach(() => {
    getViewerMock.mockResolvedValue({ id: "user-b", role: "MEMBER", isMonoMode: false });
    institutionFindMany.mockResolvedValue([{ id: "inst-1" }, { id: "inst-2" }]);
  });

  it("counts as triggered when at least one institution's sync started", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    await expect(autoTriggerSync()).resolves.toEqual({ triggered: true });
  });

  it("is not triggered when every institution's sync failed to start", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(autoTriggerSync()).resolves.toEqual({ triggered: false });
  });
});
