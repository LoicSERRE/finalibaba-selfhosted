import { beforeEach, describe, expect, it, vi } from "vitest";

// createAccount's first balance row. A net-worth history counts an account
// only from its first row, and a property or a vehicle used to get none until
// its value was next edited - while its loan got one at creation. A building
// bought with a mortgage then drew the curve below zero (the loan subtracted,
// the building absent) until someone retyped the building's value.

const h = vi.hoisted(() => ({
  accountCreate: vi.fn(async ({ data }: { data: { type: string } }) => ({ id: "acc-new", ...data })),
  balanceCreate: vi.fn(async () => ({})),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    account: { create: h.accountCreate },
    historicalBalance: { create: h.balanceCreate },
    userSettings: { findUnique: async () => null },
  },
}));
vi.mock("@/lib/auth-context", () => ({
  getViewer: async () => ({ id: "user-owner", role: "ADMIN", isMonoMode: true }),
  assertOwned: async () => {},
  assertAccountWritable: async () => {},
}));
vi.mock("@/lib/services/company-guards", () => ({ companyForNewAccount: async () => null }));

const { createAccount } = await import("@/lib/actions/accounts");

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => vi.clearAllMocks());

describe("the first balance row at creation", () => {
  it.each(["REAL_ESTATE", "AUTOMOBILE"])("is written for a %s, at its value", async (type) => {
    await createAccount(form({ name: "Bien", type, initialBalance: "240000", liability: "0" }));
    expect(h.balanceCreate).toHaveBeenCalledTimes(1);
    expect(h.balanceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ accountId: "acc-new", balanceCents: BigInt(240_000_00) }),
    });
  });

  it("is still written for a fiat account", async () => {
    await createAccount(form({ name: "Livret", type: "SAVINGS", initialBalance: "1000" }));
    expect(h.balanceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ balanceCents: BigInt(1_000_00) }),
    });
  });

  it("is the loan's zero row for a loan, unchanged", async () => {
    await createAccount(form({ name: "Prêt", type: "LOAN", loanAmount: "72400", loanTaeg: "2", loanDurationMonths: "240" }));
    expect(h.balanceCreate).toHaveBeenCalledTimes(1);
    expect(h.balanceCreate).toHaveBeenCalledWith({ data: { accountId: "acc-new", balanceCents: BigInt(0) } });
  });

  it("is not written for a property entered without a value", async () => {
    await createAccount(form({ name: "Bien", type: "REAL_ESTATE" }));
    expect(h.balanceCreate).not.toHaveBeenCalled();
  });
});
