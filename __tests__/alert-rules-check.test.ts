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

const { findManyMock, updateMock, dispatchMock, txFindManyMock, txFindFirstMock, txAggregateMock, splitAggregateMock, holdingFindManyMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  updateMock: vi.fn(),
  dispatchMock: vi.fn(),
  txFindManyMock: vi.fn(),
  txFindFirstMock: vi.fn(),
  txAggregateMock: vi.fn(),
  splitAggregateMock: vi.fn(),
  holdingFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    alertRule: { findMany: findManyMock, update: updateMock },
    transaction: {
      findMany: txFindManyMock,
      findFirst: txFindFirstMock,
      aggregate: txAggregateMock,
      groupBy: vi.fn().mockResolvedValue([]),
    },
    transactionSplit: { groupBy: vi.fn().mockResolvedValue([]), aggregate: splitAggregateMock },
    holding: { findMany: holdingFindManyMock },
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
  txFindManyMock.mockReset().mockResolvedValue([]);
  txFindFirstMock.mockReset().mockResolvedValue(null);
  txAggregateMock.mockReset().mockResolvedValue({ _count: 0, _max: { createdAt: null }, _sum: { amountCents: BigInt(0) } });
  splitAggregateMock.mockReset().mockResolvedValue({ _sum: { amountCents: BigInt(0) } });
  holdingFindManyMock.mockReset().mockResolvedValue([]);
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


describe("a NEW_TRANSACTION rule, where one sync batch shares one timestamp", () => {
  const BATCH_AT = new Date("2026-09-12T08:00:00.000Z");

  function newTxRule(over: Record<string, unknown> = {}) {
    return rule({
      kind: "NEW_TRANSACTION",
      accountId: null,
      transactionDirection: null,
      balanceThresholdCents: null,
      lastNotifiedTransactionAt: new Date("2026-09-11T00:00:00.000Z"),
      ...over,
    });
  }

  it("establishes a baseline on the first check without notifying", async () => {
    findManyMock.mockResolvedValue([newTxRule({ lastNotifiedTransactionAt: null })]);
    txFindFirstMock.mockResolvedValue({ createdAt: BATCH_AT });

    const fired = await checkCustomAlertRules(SETTINGS, ["acc-1"]);

    // Creating the rule must not dump an account's whole history into one
    // notification - the first pass only records where it starts.
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(fired).toEqual([]);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastNotifiedTransactionAt: BATCH_AT } })
    );
  });

  it("counts every new row, not just the ones it lists", async () => {
    // The incident. A digest is capped, but a sync batch shares one createdAt,
    // so counting only the page made the message claim 20 when 57 had arrived.
    const page = Array.from({ length: 20 }, (_, i) => ({
      id: `t${i}`, label: `Achat ${i}`, amountCents: BigInt(-1_00), createdAt: BATCH_AT,
    }));
    findManyMock.mockResolvedValue([newTxRule()]);
    txAggregateMock.mockResolvedValue({ _count: 57, _max: { createdAt: BATCH_AT } });
    txFindManyMock.mockResolvedValue(page);

    const fired = await checkCustomAlertRules(SETTINGS, ["acc-1"]);

    expect(fired).toEqual(["new_transaction_rule:rule-1"]);
    const [, title, body] = dispatchMock.mock.calls[0];
    expect(title).toContain("57");
    // The digest lists 5 (MAX_TRANSACTIONS_IN_DIGEST) and counts against the
    // aggregate, not against the 20 rows the query fetched: 57 - 5.
    expect(body).toContain("52 autre");
  });

  it("advances the cursor to the batch maximum, never to the last row shown", async () => {
    // This is what stopped rows past the cap being skipped FOREVER: the whole
    // batch shares a timestamp, so a cursor set from the page would still be
    // the batch's timestamp and `gt` would drop the other 37 for good.
    // The page and the aggregate must differ or this asserts nothing: the rows
    // past the cap are the later ones, so the last one SHOWN is older than the
    // real maximum.
    const LAST_SHOWN = new Date("2026-09-12T07:00:00.000Z");
    findManyMock.mockResolvedValue([newTxRule()]);
    txAggregateMock.mockResolvedValue({ _count: 57, _max: { createdAt: BATCH_AT } });
    txFindManyMock.mockResolvedValue([
      { id: "t0", label: "Achat", amountCents: BigInt(-1_00), createdAt: LAST_SHOWN },
    ]);

    await checkCustomAlertRules(SETTINGS, ["acc-1"]);

    const cursorWrite = updateMock.mock.calls.find(([a]) => a.data?.lastNotifiedTransactionAt);
    expect(cursorWrite?.[0].data.lastNotifiedTransactionAt).toEqual(BATCH_AT);
    expect(cursorWrite?.[0].data.lastNotifiedTransactionAt).not.toEqual(LAST_SHOWN);
  });

  it("says nothing and moves nothing when no transaction has arrived", async () => {
    findManyMock.mockResolvedValue([newTxRule()]);
    txAggregateMock.mockResolvedValue({ _count: 0, _max: { createdAt: null } });

    const fired = await checkCustomAlertRules(SETTINGS, ["acc-1"]);

    expect(dispatchMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(fired).toEqual([]);
  });

  it("reads the cursor strictly, so a row at the cursor instant is not re-sent", async () => {
    findManyMock.mockResolvedValue([newTxRule({ lastNotifiedTransactionAt: BATCH_AT })]);
    txAggregateMock.mockResolvedValue({ _count: 0, _max: { createdAt: null } });

    await checkCustomAlertRules(SETTINGS, ["acc-1"]);

    const where = txAggregateMock.mock.calls[0][0].where;
    expect(where.createdAt).toEqual({ gt: BATCH_AT });
  });
});


describe("a BUDGET_OVERRUN rule, where the bug is always a missing filter", () => {
  const MONTH = "2026-09";

  function budgetRule(over: Record<string, unknown> = {}) {
    return rule({
      kind: "BUDGET_OVERRUN",
      account: null,
      category: { id: "cat-1", name: "Alimentation", budgetCents: BigInt(400_00) },
      budgetOverrunLastFiredPeriod: null,
      ...over,
    });
  }

  /** Spend is stored negative; the checker flips the sign. */
  function spent(plain: number, split = 0) {
    txAggregateMock.mockResolvedValue({ _sum: { amountCents: BigInt(-plain) } });
    splitAggregateMock.mockResolvedValue({ _sum: { amountCents: BigInt(-split) } });
  }

  it("excludes internal transfers and securities from BOTH queries", async () => {
    // The one documented bug in this file: checkBudgetOverrunRule never
    // filtered isInternalTransfer at all, unlike every other category-spend
    // query in the app, so a manually-categorised transfer counted toward the
    // alert but never toward the /budgets card the alert points the user at.
    // A missing filter does not fail - it includes too much, silently.
    findManyMock.mockResolvedValue([budgetRule()]);
    spent(100_00);

    await checkCustomAlertRules(SETTINGS, ["acc-1"]);

    const txWhere = txAggregateMock.mock.calls[0][0].where;
    expect(txWhere.isInternalTransfer).toBe(false);
    expect(txWhere.isSecuritiesMovement).toBe(false);

    // The split side filters through the PARENT transaction, since a split
    // row carries no date or account of its own.
    const splitWhere = splitAggregateMock.mock.calls[0][0].where;
    expect(splitWhere.transaction.isInternalTransfer).toBe(false);
    expect(splitWhere.transaction.isSecuritiesMovement).toBe(false);
  });

  it("counts split rows alongside plain ones", async () => {
    // A split transaction's own categoryId is null, so it is invisible to the
    // plain query. Missing the second one understates spend and the alert
    // never fires.
    findManyMock.mockResolvedValue([budgetRule()]);
    spent(250_00, 200_00);   // 450 EUR against a 400 EUR budget, only together

    const fired = await checkCustomAlertRules(SETTINGS, ["acc-1"]);

    expect(fired).toEqual(["budget_overrun_rule:rule-1"]);
    expect(dispatchMock.mock.calls[0][2]).toContain("450");
  });

  it("stays quiet while the envelope holds", async () => {
    findManyMock.mockResolvedValue([budgetRule()]);
    spent(399_99);

    await expect(checkCustomAlertRules(SETTINGS, ["acc-1"])).resolves.toEqual([]);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("counts debits only, scoped to this month and these accounts", async () => {
    findManyMock.mockResolvedValue([budgetRule()]);
    spent(100_00);

    await checkCustomAlertRules(SETTINGS, ["acc-1", "acc-2"]);

    const w = txAggregateMock.mock.calls[0][0].where;
    expect(w.amountCents).toEqual({ lt: BigInt(0) });
    expect(w.accountId).toEqual({ in: ["acc-1", "acc-2"] });
    expect(w.categoryId).toBe("cat-1");
    expect(w.date.gte).toBeInstanceOf(Date);
    expect(w.date.lt.getTime()).toBeGreaterThan(w.date.gte.getTime());
  });

  it("re-arms every month instead of edge-triggering", async () => {
    // A category that overran in July should be able to alert again in
    // August, though spend never "un-overran" in between.
    findManyMock.mockResolvedValue([budgetRule({ budgetOverrunLastFiredPeriod: MONTH })]);
    spent(500_00);
    await checkCustomAlertRules(SETTINGS, ["acc-1"]);
    const firedSamePeriod = dispatchMock.mock.calls.length;

    dispatchMock.mockClear();
    findManyMock.mockResolvedValue([budgetRule({ budgetOverrunLastFiredPeriod: "2026-08" })]);
    spent(500_00);
    await checkCustomAlertRules(SETTINGS, ["acc-1"]);

    expect(firedSamePeriod).toBe(0);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores a category with no budget set rather than treating it as zero", async () => {
    findManyMock.mockResolvedValue([budgetRule({ category: { id: "cat-1", name: "X", budgetCents: null } })]);
    spent(999_00);

    await expect(checkCustomAlertRules(SETTINGS, ["acc-1"])).resolves.toEqual([]);
    expect(txAggregateMock).not.toHaveBeenCalled();
  });
});


describe("the three kinds whose maths is already covered elsewhere", () => {
  // __tests__/alerts.test.ts pins computeHoldingDriftPts, computeUnrealizedGain
  // and evaluatePercentAlert. What is left untested is the wiring around them,
  // which is where this file's only real bug has ever been.
  const HOLDING = {
    id: "h1", ticker: "IE00B4L5Y983", name: "MSCI World",
    lastPriceCents: BigInt(100_00), costBasisCents: BigInt(80_00),
    quantity: { toString: () => "10" },
    targetPct: 0.5,
    account: { name: "PEA", holdings: [] as unknown[] },
  };

  it("HOLDING_PRICE reads the position's own price, and names the account", async () => {
    const holding = { ...HOLDING, account: { name: "PEA", holdings: [] } };
    findManyMock.mockResolvedValue([
      rule({ kind: "HOLDING_PRICE", account: null, holding, balanceThresholdCents: BigInt(90_00), balanceLastAbove: false }),
    ]);

    const fired = await checkCustomAlertRules(SETTINGS, ["acc-1"]);

    expect(fired).toEqual(["holding_price_rule:rule-1"]);
    const [, title, body] = dispatchMock.mock.calls[0];
    expect(title).toContain("prix");
    expect(body).toContain("MSCI World");
    expect(body).toContain("PEA");
  });

  it("REBALANCING_DRIFT goes quiet when the target was cleared after the rule was made", async () => {
    // Not a malformed row: a person removed the target, and a rule outliving
    // it must do nothing rather than compare against zero.
    findManyMock.mockResolvedValue([
      rule({ kind: "REBALANCING_DRIFT", account: null, gainThresholdPct: 5,
             holding: { ...HOLDING, targetPct: null, account: { name: "PEA", holdings: [HOLDING] } } }),
    ]);

    await expect(checkCustomAlertRules(SETTINGS, ["acc-1"])).resolves.toEqual([]);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("UNREALIZED_GAIN with no account aggregates across the portfolio", async () => {
    // accountId null is VALID INPUT here - "every investment and crypto
    // account" - and not the malformed-row guard it means for every other
    // kind. It is the one place a second, broader query runs.
    findManyMock.mockResolvedValue([
      rule({ kind: "UNREALIZED_GAIN", account: null, gainUnit: "AMOUNT",
             balanceThresholdCents: BigInt(1_000_00), balanceLastAbove: false }),
    ]);
    holdingFindManyMock.mockResolvedValue([
      { quantity: { toString: () => "10" }, lastPriceCents: BigInt(200_00), costBasisCents: BigInt(50_00) },
    ]);

    const fired = await checkCustomAlertRules(SETTINGS, ["acc-1", "acc-2"]);

    expect(holdingFindManyMock).toHaveBeenCalledTimes(1);
    const where = holdingFindManyMock.mock.calls[0][0].where;
    expect(where.accountId).toEqual({ in: ["acc-1", "acc-2"] });
    // Scoped to the account types that can hold a position at all.
    expect(where.account.type).toEqual({ in: ["INVESTMENT", "CRYPTO"] });
    expect(fired).toEqual(["unrealized_gain_rule:rule-1"]);
  });

  it("UNREALIZED_GAIN with an account reads that account and queries nothing", async () => {
    findManyMock.mockResolvedValue([
      rule({ kind: "UNREALIZED_GAIN", gainUnit: "AMOUNT", balanceThresholdCents: BigInt(1_000_00),
             balanceLastAbove: false,
             account: { ...ACCOUNT, holdings: [
               { quantity: { toString: () => "10" }, lastPriceCents: BigInt(200_00), costBasisCents: BigInt(50_00) },
             ] } }),
    ]);

    await checkCustomAlertRules(SETTINGS, ["acc-1"]);

    expect(holdingFindManyMock).not.toHaveBeenCalled();
  });
});
