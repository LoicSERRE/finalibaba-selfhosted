import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sync-failure state machine: which broken bank gets a notification, and
 * far more importantly, which one ever stops getting them.
 *
 * Three separate production incidents live in this one function, all the same
 * shape - an alert with nothing that could ever clear it:
 *
 *  - a source whose credentials were removed kept saying "still broken" every
 *    24h forever, because only a fresh `success` row clears a state and a
 *    retired source never writes one again
 *  - a captcha bank the 4h cron can never satisfy would have reminded the user
 *    daily about something they already knew
 *  - a realtime listener's own failure arrived titled `trade_republic_realtime`,
 *    which names nothing to anybody, duplicating the batch sync's alert
 *
 * `classifySyncSource` decides which of those applies and is pinned separately
 * in sync-status.test.ts. What these cover is the wiring: whether the verdict
 * actually reaches the row, because a state that is skipped rather than
 * DELETED is exactly how "forever" happens.
 */

const { groupByMock, logFindManyMock, stateFindManyMock, stateCreateMock, stateUpdateMock, stateDeleteMock, instFindManyMock, dispatchMock } =
  vi.hoisted(() => ({
    groupByMock: vi.fn(),
    logFindManyMock: vi.fn(),
    stateFindManyMock: vi.fn(),
    stateCreateMock: vi.fn(),
    stateUpdateMock: vi.fn(),
    stateDeleteMock: vi.fn(),
    instFindManyMock: vi.fn(),
    dispatchMock: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    syncLog: { groupBy: groupByMock, findMany: logFindManyMock },
    syncFailureState: {
      findMany: stateFindManyMock,
      create: stateCreateMock,
      update: stateUpdateMock,
      delete: stateDeleteMock,
    },
    institution: { findMany: instFindManyMock },
  },
}));
vi.mock("@/lib/services/notifications", () => ({ dispatchAlert: dispatchMock }));

import { checkSyncFailures } from "@/lib/services/alerts/sync-failures";

const SETTINGS = { userId: "user-a", syncFailureAlertsEnabled: true } as never;
const AT = new Date("2026-09-12T08:00:00.000Z");

/** One source, one latest SyncLog row, optionally one existing state row. */
function scenario(source: string, status: string, state?: { lastAlertedAt: Date }) {
  groupByMock.mockResolvedValue([{ source, _max: { createdAt: AT } }]);
  logFindManyMock.mockResolvedValue([{ source, status, createdAt: AT, message: null }]);
  stateFindManyMock.mockResolvedValue(state ? [{ source, lastAlertedAt: state.lastAlertedAt }] : []);
}

beforeEach(() => {
  groupByMock.mockReset().mockResolvedValue([]);
  logFindManyMock.mockReset().mockResolvedValue([]);
  stateFindManyMock.mockReset().mockResolvedValue([]);
  stateCreateMock.mockReset().mockResolvedValue({});
  stateUpdateMock.mockReset().mockResolvedValue({});
  stateDeleteMock.mockReset().mockResolvedValue({});
  instFindManyMock.mockReset().mockResolvedValue([]);
  dispatchMock.mockReset().mockResolvedValue(undefined);
  process.env.LCL_LOGIN = "someone";
  process.env.TR_PHONE = "+33600000000";
});

describe("the toggle comes first", () => {
  it("reads nothing at all when sync-failure alerts are off", async () => {
    await expect(
      checkSyncFailures({ userId: "user-a", syncFailureAlertsEnabled: false } as never)
    ).resolves.toEqual([]);
    expect(groupByMock).not.toHaveBeenCalled();
  });
});

describe("a newly broken source", () => {
  it("opens a state row and notifies, once", async () => {
    scenario("lcl", "error");

    const fired = await checkSyncFailures(SETTINGS);

    expect(stateCreateMock).toHaveBeenCalledWith({ data: { userId: "user-a", source: "lcl" } });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0][1]).toBe("Échec de synchronisation");
    expect(dispatchMock.mock.calls[0][2]).toContain("LCL");
    expect(fired).toEqual(["lcl"]);
  });

  it("says reconnect, not a vague problem, when the session expired", async () => {
    scenario("lcl", "auth_required");

    await checkSyncFailures(SETTINGS);

    expect(dispatchMock.mock.calls[0][2]).toContain("Reconnecte-toi");
  });
});

describe("a source that is still broken", () => {
  it("stays silent inside the 24h window", async () => {
    scenario("lcl", "error", { lastAlertedAt: new Date(Date.now() - 60 * 60 * 1000) });

    const fired = await checkSyncFailures(SETTINGS);

    expect(dispatchMock).not.toHaveBeenCalled();
    expect(stateUpdateMock).not.toHaveBeenCalled();
    expect(fired).toEqual([]);
  });

  it("reminds once the window has passed, and moves the clock", async () => {
    scenario("lcl", "error", { lastAlertedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });

    const fired = await checkSyncFailures(SETTINGS);

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0][1]).toContain("toujours en cours");
    // Without moving lastAlertedAt the next run reminds again immediately.
    expect(stateUpdateMock).toHaveBeenCalledTimes(1);
    expect(fired).toEqual(["lcl"]);
  });
});

describe("what makes an alert stop, which is the part that has failed three times", () => {
  it("DELETES the state when a source succeeds again, rather than skipping it", async () => {
    scenario("lcl", "success", { lastAlertedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });

    const fired = await checkSyncFailures(SETTINGS);

    expect(stateDeleteMock).toHaveBeenCalledWith({
      where: { userId_source: { userId: "user-a", source: "lcl" } },
    });
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(fired).toEqual([]);
  });

  it("clears a retired source instead of reminding about it forever", async () => {
    // The original incident: LCL_LOGIN was removed from .env, so the dedicated
    // source can never write another SyncLog row - and only a fresh success
    // row clears a state. It reminded every 24h with no way to self-heal.
    delete process.env.LCL_LOGIN;
    scenario("lcl", "auth_required", { lastAlertedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });

    const fired = await checkSyncFailures(SETTINGS);

    expect(stateDeleteMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(fired).toEqual([]);
  });

  it("never raises a realtime listener's own alert, and clears one left behind", async () => {
    // A listener and its batch sync share one Trade Republic session, so a dead
    // session fails both - and only the batch sync's alert names something the
    // user recognises. `trade_republic_realtime` names nothing.
    scenario("tr-realtime:inst-1", "error", { lastAlertedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });
    instFindManyMock.mockResolvedValue([
      { id: "inst-1", name: "Trade Republic", woobModule: null, trPhone: "+33600000000" },
    ]);

    const fired = await checkSyncFailures(SETTINGS);

    expect(dispatchMock).not.toHaveBeenCalled();
    expect(stateDeleteMock).toHaveBeenCalledTimes(1);
    expect(fired).toEqual([]);
  });
});

describe("nothing to report", () => {
  it("does no work when no source has ever logged", async () => {
    groupByMock.mockResolvedValue([]);

    await expect(checkSyncFailures(SETTINGS)).resolves.toEqual([]);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(stateCreateMock).not.toHaveBeenCalled();
  });
});
