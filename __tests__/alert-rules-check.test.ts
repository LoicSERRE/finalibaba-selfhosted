import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The user-defined AlertRule checkers, which decide whether a phone buzzes
 * about somebody's money. 0% covered until v2.10.4 moved them out of app/api/,
 * where sonar.coverage.exclusions meant they reported nothing at all.
 *
 * The invariant worth the mocking is the edge trigger. `balanceLastAbove` is
 * three-valued on purpose - null means "never evaluated" - because a threshold
 * set below a balance that is already above it must NOT fire on the very next
 * cron run. Getting that wrong is not a crash: it is a notification at 3am
 * about nothing having happened, and then silence when it actually does.
 */

const { findManyMock, updateMock, dispatchMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  updateMock: vi.fn(),
  dispatchMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    alertRule: { findMany: findManyMock, update: updateMock },
    transaction: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
    transactionSplit: { groupBy: vi.fn().mockResolvedValue([]) },
    holding: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("@/lib/services/notifications", () => ({ dispatchAlert: dispatchMock }));

import { checkCustomAlertRules } from "@/lib/services/alerts/custom-rules";

const SETTINGS = { userId: "user-a" } as never;

/** An account sitting at 100 EUR, which is the figure every rule below reads. */
const ACCOUNT = {
  id: "acc-1",
  name: "Courant",
  history: [{ balanceCents: BigInt(100_00) }],
  holdings: [],
};

function rule(over: Record<string, unknown> = {}) {
  return {
    id: "rule-1",
    kind: "ACCOUNT_BALANCE",
    message: null,
    balanceThresholdCents: BigInt(50_00),
    balanceLastAbove: null,
    account: ACCOUNT,
    holding: null,
    category: null,
    ...over,
  };
}

beforeEach(() => {
  findManyMock.mockReset().mockResolvedValue([]);
  updateMock.mockReset().mockResolvedValue({});
  dispatchMock.mockReset().mockResolvedValue(undefined);
});

describe("the first check only establishes a baseline", () => {
  it("does not notify about a threshold that was already crossed when it was set", () => {
    findManyMock.mockResolvedValue([rule({ balanceLastAbove: null })]);

    return checkCustomAlertRules(SETTINGS, ["acc-1"]).then((fired) => {
      expect(dispatchMock).not.toHaveBeenCalled();
      expect(fired).toEqual([]);
      // It still records where it started, or every later run is a first run.
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: { balanceLastAbove: true } })
      );
    });
  });
});

describe("afterwards it fires only on a crossing", () => {
  it("notifies when the balance falls back below a threshold it was above", async () => {
    findManyMock.mockResolvedValue([
      rule({ balanceLastAbove: true, balanceThresholdCents: BigInt(200_00) }),
    ]);

    const fired = await checkCustomAlertRules(SETTINGS, ["acc-1"]);

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(fired).toEqual(["account_balance_rule:rule-1"]);
    const [, title, body] = dispatchMock.mock.calls[0];
    expect(title).toBe("Alerte solde de compte");
    expect(body).toContain("Courant");
    expect(body).toContain("en dessous");
  });

  it("stays silent while nothing changes, and writes nothing either", async () => {
    findManyMock.mockResolvedValue([rule({ balanceLastAbove: true })]);

    const fired = await checkCustomAlertRules(SETTINGS, ["acc-1"]);

    expect(dispatchMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(fired).toEqual([]);
  });

  it("appends the user's own message when they wrote one", async () => {
    findManyMock.mockResolvedValue([
      rule({ balanceLastAbove: false, message: "Vire de l'épargne" }),
    ]);

    await checkCustomAlertRules(SETTINGS, ["acc-1"]);

    expect(dispatchMock.mock.calls[0][2]).toContain("Vire de l'épargne");
  });
});

describe("an overdraft rule is the same comparison and a different sentence", () => {
  it("says overdraft rather than quoting a threshold the user never typed", async () => {
    findManyMock.mockResolvedValue([
      rule({
        kind: "ACCOUNT_OVERDRAFT",
        balanceThresholdCents: BigInt(0),
        balanceLastAbove: false,
      }),
    ]);

    const fired = await checkCustomAlertRules(SETTINGS, ["acc-1"]);

    const [, title, body] = dispatchMock.mock.calls[0];
    expect(title).toBe("Alerte découvert");
    expect(body).toContain("repassé au-dessus");
    expect(fired).toEqual(["account_overdraft_rule:rule-1"]);
  });
});

describe("a malformed row is skipped, never crashed on", () => {
  it("ignores a rule whose account was deleted out from under it", async () => {
    findManyMock.mockResolvedValue([rule({ account: null })]);

    await expect(checkCustomAlertRules(SETTINGS, ["acc-1"])).resolves.toEqual([]);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("ignores a rule with no threshold stored", async () => {
    findManyMock.mockResolvedValue([rule({ balanceThresholdCents: null })]);

    await expect(checkCustomAlertRules(SETTINGS, ["acc-1"])).resolves.toEqual([]);
  });

  it("ignores a kind it has no checker for instead of throwing", async () => {
    findManyMock.mockResolvedValue([rule({ kind: "SOMETHING_NEW" })]);

    await expect(checkCustomAlertRules(SETTINGS, ["acc-1"])).resolves.toEqual([]);
  });
});

describe("an account with no recorded balance reads as zero, not as an error", () => {
  it("treats a history-less account as 0 and compares from there", async () => {
    findManyMock.mockResolvedValue([
      rule({ account: { ...ACCOUNT, history: [] }, balanceLastAbove: true }),
    ]);

    const fired = await checkCustomAlertRules(SETTINGS, ["acc-1"]);

    expect(fired).toEqual(["account_balance_rule:rule-1"]);
    expect(dispatchMock.mock.calls[0][2]).toContain("en dessous");
  });
});

describe("no rules at all", () => {
  it("does no work and reads nothing further", async () => {
    findManyMock.mockResolvedValue([]);

    await expect(checkCustomAlertRules(SETTINGS, ["acc-1"])).resolves.toEqual([]);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
