import { beforeEach, describe, expect, it, vi } from "vitest";

// Light coverage only, per this project's stated lib/actions/* boundary (see
// sonar-project.properties' sonar.coverage.exclusions comment). This file
// exists because manual entry writes to TWO tables that must agree - a
// Transaction and the HistoricalBalance rows it shifts - and the arithmetic is
// about real money with no undo. The pure part is covered in
// __tests__/manual-entries.test.ts; what is asserted here is the SEQUENCE,
// which is the half a pure test cannot reach.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const {
  accountFindUniqueMock,
  balanceFindManyMock,
  balanceUpdateManyMock,
  balanceCreateMock,
  balanceFindFirstMock,
  balanceUpdateMock,
  txCreateMock,
  txFindUniqueMock,
  txDeleteMock,
  autoCategorizeMock,
} = vi.hoisted(() => ({
  accountFindUniqueMock: vi.fn(),
  balanceFindManyMock: vi.fn(),
  balanceUpdateManyMock: vi.fn(),
  balanceCreateMock: vi.fn(),
  balanceFindFirstMock: vi.fn(),
  balanceUpdateMock: vi.fn(),
  txCreateMock: vi.fn(),
  txFindUniqueMock: vi.fn(),
  txDeleteMock: vi.fn(),
  autoCategorizeMock: vi.fn(),
}));

// Built inside vi.hoisted, not as a plain const: vi.mock's factory is hoisted
// above every top-level statement, so referencing one from it throws
// "Cannot access before initialization" at import time.
const { client } = vi.hoisted(() => {
  const c = {
    account: { findUnique: accountFindUniqueMock },
    historicalBalance: {
      findMany: balanceFindManyMock,
      updateMany: balanceUpdateManyMock,
      create: balanceCreateMock,
      findFirst: balanceFindFirstMock,
      update: balanceUpdateMock,
    },
    transaction: { create: txCreateMock, findUnique: txFindUniqueMock, delete: txDeleteMock },
  };
  return { client: c };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    ...client,
    // Hands the callback the same mocks, so an assertion does not care whether
    // a write went through the transaction client or the top-level one.
    $transaction: vi.fn(async (fn: (tx: typeof client) => Promise<unknown>) => fn(client)),
  },
}));

vi.mock("@/lib/auth-context", () => ({
  getViewer: vi.fn(async () => ({ id: "user-owner", role: "ADMIN", isMonoMode: true })),
  assertAccountWritable: vi.fn(async () => {}),
}));

vi.mock("@/lib/actions/auto-categorize", () => ({ autoCategorizeTransactions: autoCategorizeMock }));

import { recordManualMovement, setManualBalance, deleteManualEntry } from "@/lib/actions/manual-entries";
import { atNoonUtc } from "@/lib/domain/manual-entries";

const ELIGIBLE = { type: "MEAL_VOUCHER", syncId: null, gocardlessAccountId: null };

beforeEach(() => {
  accountFindUniqueMock.mockReset().mockResolvedValue(ELIGIBLE);
  balanceFindManyMock.mockReset().mockResolvedValue([]);
  balanceUpdateManyMock.mockReset().mockResolvedValue({ count: 0 });
  balanceCreateMock.mockReset().mockResolvedValue({});
  balanceFindFirstMock.mockReset().mockResolvedValue(null);
  balanceUpdateMock.mockReset().mockResolvedValue({});
  txCreateMock.mockReset().mockResolvedValue({});
  txFindUniqueMock.mockReset();
  txDeleteMock.mockReset().mockResolvedValue({});
  autoCategorizeMock.mockReset().mockResolvedValue(undefined);
});

describe("recordManualMovement", () => {
  it("writes a negative transaction AND shifts the balance by the same amount", async () => {
    balanceFindManyMock.mockResolvedValue([{ recordedAt: atNoonUtc("2026-01-01"), balanceCents: BigInt(10_000) }]);

    const result = await recordManualMovement("acc-1", {
      amountCents: -1_250,
      label: "Boulangerie",
      date: "2026-01-05",
    });

    expect(result).toEqual({ ok: true });

    // The two writes that must agree. A Transaction alone leaves a ledger that
    // does not add up to the balance printed above it; a balance shift alone
    // moves the figure with nothing to explain it.
    expect(txCreateMock).toHaveBeenCalledTimes(1);
    const tx = txCreateMock.mock.calls[0][0].data;
    expect(tx.amountCents).toBe(BigInt(-1_250));
    expect(tx.label).toBe("Boulangerie");
    expect(tx.syncId.startsWith("manual_")).toBe(true);
    expect(tx.date).toEqual(atNoonUtc("2026-01-05"));

    expect(balanceUpdateManyMock).toHaveBeenCalledWith({
      where: { accountId: "acc-1", recordedAt: { gte: atNoonUtc("2026-01-05") } },
      data: { balanceCents: { increment: BigInt(-1_250) } },
    });
    expect(balanceCreateMock.mock.calls[0][0].data.balanceCents).toBe(BigInt(8_750));
  });

  it("keeps a top-up positive", async () => {
    await recordManualMovement("acc-1", { amountCents: 10_000, label: "Recharge", date: "2026-01-05" });
    expect(txCreateMock.mock.calls[0][0].data.amountCents).toBe(BigInt(10_000));
  });

  // The case a naive implementation gets wrong: the anchor must be built on
  // the balance immediately BEFORE the entry, never the latest row overall.
  it("anchors a backdated entry on the balance that preceded it", async () => {
    balanceFindManyMock.mockResolvedValue([
      { recordedAt: atNoonUtc("2026-01-01"), balanceCents: BigInt(10_000) },
      { recordedAt: atNoonUtc("2026-01-10"), balanceCents: BigInt(13_800) },
    ]);

    await recordManualMovement("acc-1", { amountCents: -500, label: "Oubli", date: "2026-01-05" });

    expect(balanceCreateMock.mock.calls[0][0].data.balanceCents).toBe(BigInt(9_500));
  });

  it("adds no anchor row when one already sits on that day - it is shifted instead", async () => {
    balanceFindManyMock.mockResolvedValue([{ recordedAt: atNoonUtc("2026-01-05"), balanceCents: BigInt(8_800) }]);

    await recordManualMovement("acc-1", { amountCents: -500, label: "Café", date: "2026-01-05" });

    expect(balanceCreateMock).not.toHaveBeenCalled();
    expect(balanceUpdateManyMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a future date without writing anything at all", async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    const result = await recordManualMovement("acc-1", { amountCents: -100, label: "x", date: tomorrow });

    expect(result).toEqual({ ok: false, error: "future_date" });
    expect(txCreateMock).not.toHaveBeenCalled();
    expect(balanceUpdateManyMock).not.toHaveBeenCalled();
    expect(balanceCreateMock).not.toHaveBeenCalled();
  });

  it("refuses a blank label without writing anything at all", async () => {
    const result = await recordManualMovement("acc-1", { amountCents: -100, label: "   ", date: "2026-01-05" });

    expect(result).toEqual({ ok: false, error: "label_required" });
    expect(txCreateMock).not.toHaveBeenCalled();
    expect(balanceUpdateManyMock).not.toHaveBeenCalled();
  });

  it("refuses an account that syncs, so a bank's own history is never rewritten", async () => {
    accountFindUniqueMock.mockResolvedValue({ type: "CHECKING", syncId: "woob:x:1", gocardlessAccountId: null });

    await expect(
      recordManualMovement("acc-1", { amountCents: -100, label: "x", date: "2026-01-05" }),
    ).rejects.toThrow();
    expect(txCreateMock).not.toHaveBeenCalled();
  });
});

describe("setManualBalance", () => {
  // The distinguishing property of a correction: the figure was wrong, nothing
  // happened, so no budget should ever see a movement for it.
  it("writes a snapshot and NO transaction", async () => {
    const result = await setManualBalance("acc-1", 8_750);

    expect(result).toEqual({ ok: true });
    expect(balanceCreateMock).toHaveBeenCalledTimes(1);
    expect(balanceCreateMock.mock.calls[0][0].data.balanceCents).toBe(BigInt(8_750));
    expect(txCreateMock).not.toHaveBeenCalled();
    expect(balanceUpdateManyMock).not.toHaveBeenCalled();
  });

  it("updates today's row in place rather than stacking a second one", async () => {
    balanceFindFirstMock.mockResolvedValue({ id: "bal-1" });

    await setManualBalance("acc-1", 9_000);

    expect(balanceCreateMock).not.toHaveBeenCalled();
    expect(balanceUpdateMock).toHaveBeenCalledWith({
      where: { id: "bal-1" },
      data: { balanceCents: BigInt(9_000) },
    });
  });
});

describe("deleteManualEntry", () => {
  it("undoes exactly what the entry did to the balance", async () => {
    txFindUniqueMock.mockResolvedValue({
      id: "tx-1",
      accountId: "acc-1",
      amountCents: BigInt(-1_250),
      date: atNoonUtc("2026-01-05"),
      syncId: "manual_abc",
      categoryId: null,
    });

    const result = await deleteManualEntry("tx-1");

    expect(result).toEqual({ ok: true });
    expect(balanceUpdateManyMock).toHaveBeenCalledWith({
      where: { accountId: "acc-1", recordedAt: { gte: atNoonUtc("2026-01-05") } },
      data: { balanceCents: { decrement: BigInt(-1_250) } },
    });
    expect(txDeleteMock).toHaveBeenCalledWith({ where: { id: "tx-1" } });
  });

  // A CSV-imported row never moved a balance, so "reversing" one would invent
  // a movement that never happened.
  it("refuses a row it did not create, and touches no balance", async () => {
    txFindUniqueMock.mockResolvedValue({
      id: "tx-2",
      accountId: "acc-1",
      amountCents: BigInt(-1_250),
      date: atNoonUtc("2026-01-05"),
      syncId: "csv_abc",
      categoryId: null,
    });

    const result = await deleteManualEntry("tx-2");

    expect(result).toEqual({ ok: false, error: "not_manual" });
    expect(balanceUpdateManyMock).not.toHaveBeenCalled();
    expect(txDeleteMock).not.toHaveBeenCalled();
  });

  it("reports a row that no longer exists instead of throwing", async () => {
    txFindUniqueMock.mockResolvedValue(null);
    expect(await deleteManualEntry("gone")).toEqual({ ok: false, error: "not_found" });
  });
});
