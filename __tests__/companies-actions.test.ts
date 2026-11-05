import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/actions/companies.ts against a mocked Prisma client, same boundary as
// the other action tests. The security checklist of dev-docs/companies.md,
// as tests: only the manager mutates (an associate and an outsider get the
// same "Not found."), the cap table's invariant holds server-side whatever
// the client sends, and a link to another user is an invitation until THEY
// accept it.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const MANAGER = "user-a";
const COMPANY = "ckcompany00000000000000001";

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    viewer: { id: "user-a" },
    roles: new Map<string, "manager" | "associate">(),
    cookieSet: fn(),
    cookieDelete: fn(),
    company: { create: fn(), update: fn(), delete: fn() },
    associate: { create: fn(), update: fn(), updateMany: fn(), deleteMany: fn(), findMany: fn(), findFirst: fn() },
    holding: { create: fn(), deleteMany: fn() },
    account: { findFirst: fn(), findUnique: fn(), update: fn(), updateMany: fn() },
    institution: { findUnique: fn(), update: fn(), updateMany: fn() },
    coOwner: { count: fn() },
    alertRule: { deleteMany: fn() },
    goal: { deleteMany: fn() },
    user: { findUnique: fn() },
    transaction: fn(),
  };
});

vi.mock("@/lib/db/prisma", () => {
  const prisma = {
    company: h.company,
    companyAssociate: h.associate,
    companyHolding: h.holding,
    account: h.account,
    institution: h.institution,
    accountCoOwner: h.coOwner,
    alertRule: h.alertRule,
    goal: h.goal,
    user: h.user,
    $transaction: h.transaction,
  };
  return { prisma };
});

vi.mock("@/lib/auth-context", () => ({
  getViewer: async () => ({ id: h.viewer.id, role: "MEMBER", isMonoMode: false }),
  companyRole: async (userId: string, companyId: string) =>
    h.roles.get(`${userId}|${companyId}`) ?? null,
  assertCompanyManager: async (userId: string, companyId: string) => {
    if (h.roles.get(`${userId}|${companyId}`) !== "manager") throw new Error("Not found.");
  },
  assertOwned: async (_kind: string, id: string, userId: string) => {
    if (id !== "inst-own" || userId !== MANAGER) throw new Error("Not found.");
  },
  companyAccountIds: async () => ["sci-bank"],
  VIEWING_PORTFOLIO_COOKIE: "viewing_portfolio",
  COMPANY_SCOPE_PREFIX: "company:",
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: h.cookieSet, delete: h.cookieDelete }),
}));

const actions = await import("@/lib/actions/companies");

const capTable = (rows: { name: string; parts: number; username?: string; self?: boolean; id?: string }[]) => rows;

beforeEach(() => {
  vi.clearAllMocks();
  h.viewer.id = MANAGER;
  h.roles.clear();
  h.roles.set(`${MANAGER}|${COMPANY}`, "manager");
  h.roles.set(`user-b|${COMPANY}`, "associate");
  // Interactive and batch forms: run the callback against the same mocks.
  h.transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)({
      company: h.company, companyAssociate: h.associate, companyHolding: h.holding,
    }) : Promise.all(arg as unknown[]),
  );
  h.company.create.mockResolvedValue({ id: COMPANY });
  let n = 0;
  h.associate.create.mockImplementation(async () => ({ id: `assoc-${++n}` }));
  h.associate.update.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id }));
  h.associate.updateMany.mockResolvedValue({ count: 1 });
  h.user.findUnique.mockImplementation(async ({ where }: { where: { username: string } }) =>
    where.username === "marie" ? { id: "user-b" } : null,
  );
});

const valid = () => ({
  name: "SCI Les Tilleuls",
  kind: "SCI",
  taxRegime: "IR",
  totalParts: 1000,
  associates: capTable([
    { name: "Camille", parts: 600, self: true },
    { name: "Marie", parts: 400, username: "marie" },
  ]),
});

describe("createCompany", () => {
  it("makes the caller the manager, accepts their own link, and only INVITES the other user", async () => {
    await expect(actions.createCompany(valid())).resolves.toEqual({ ok: true, companyId: COMPANY });
    expect(h.company.create).toHaveBeenCalledWith({ data: expect.objectContaining({ managerUserId: MANAGER, totalParts: 1000 }) });
    const [self, other] = h.associate.create.mock.calls.map((c) => c[0].data);
    expect(self).toMatchObject({ userId: MANAGER, linkAcceptedAt: expect.any(Date) });
    expect(other).toMatchObject({ userId: "user-b", linkAcceptedAt: null });
    expect(h.holding.create.mock.calls.map((c) => c[0].data.parts)).toEqual([600, 400]);
  });

  it.each([
    ["parts that do not add up", { totalParts: 999 }, "parts_sum_mismatch"],
    ["an unknown kind", { kind: "SARL" }, "kind_invalid"],
    ["an unknown regime", { taxRegime: "XX" }, "regime_invalid"],
    ["a blank name", { name: " " }, "name_required"],
    ["associates that are not a list", { associates: { name: "x" } }, "no_associates"],
  ])("refuses %s, writing nothing", async (_label, override, error) => {
    await expect(actions.createCompany({ ...valid(), ...override } as never)).resolves.toEqual({ ok: false, error });
    expect(h.company.create).not.toHaveBeenCalled();
  });

  it("refuses an unknown username without saying which name was looked up", async () => {
    const input = valid();
    input.associates[1].username = "nobody";
    await expect(actions.createCompany(input)).resolves.toEqual({ ok: false, error: "no_such_user" });
    expect(h.company.create).not.toHaveBeenCalled();
  });

  it("refuses the caller linked twice", async () => {
    const input = valid();
    input.associates[1] = { name: "Moi encore", parts: 400, self: true };
    await expect(actions.createCompany(input)).resolves.toEqual({ ok: false, error: "self_twice" });
  });
});

describe("every manager action refuses an associate and an outsider alike", () => {
  const calls: [string, () => Promise<unknown>][] = [
    ["updateCompany", () => actions.updateCompany(COMPANY, { name: "X", kind: "SCI", taxRegime: "IR" })],
    ["saveCapTable", () => actions.saveCapTable(COMPANY, { totalParts: 10, associates: [{ name: "A", parts: 10 }] })],
    ["transferCompanyManagement", () => actions.transferCompanyManagement(COMPANY, "ckassoc0000000000000000001")],
    ["deleteCompany", () => actions.deleteCompany(COMPANY)],
    ["setAccountCompany into it", () => actions.setAccountCompany("ckaccount00000000000000001", COMPANY)],
    ["setInstitutionCompany into it", () => actions.setInstitutionCompany("inst-own", COMPANY)],
  ];

  it.each(calls)("%s - associate", async (_name, call) => {
    h.viewer.id = "user-b";
    h.account.findFirst.mockResolvedValue({ companyId: null, institutionId: null, _count: { coOwners: 0 } });
    await expect(call()).rejects.toThrow("Not found.");
  });

  it.each(calls)("%s - outsider", async (_name, call) => {
    h.viewer.id = "user-z";
    h.account.findFirst.mockResolvedValue({ companyId: null, institutionId: null, _count: { coOwners: 0 } });
    await expect(call()).rejects.toThrow("Not found.");
  });

  it("writes nothing in either case", async () => {
    h.viewer.id = "user-b";
    for (const [, call] of calls) await call().catch(() => {});
    for (const m of [h.company.update, h.company.delete, h.associate.update, h.holding.create, h.account.update, h.account.updateMany, h.institution.update]) {
      expect(m).not.toHaveBeenCalled();
    }
  });
});

describe("saveCapTable", () => {
  it("refuses an associate id from another company", async () => {
    h.associate.findMany.mockResolvedValue([{ id: "ckassoc0000000000000000001", userId: MANAGER, linkAcceptedAt: new Date() }]);
    await expect(
      actions.saveCapTable(COMPANY, {
        totalParts: 10,
        associates: [{ id: "ckforeign000000000000000001", name: "A", parts: 10 }],
      }),
    ).rejects.toThrow("Not found.");
    expect(h.holding.create).not.toHaveBeenCalled();
  });

  it("keeps an accepted link when the same user stays, and resets it when the user changes", async () => {
    const accepted = new Date("2026-01-01");
    h.associate.findMany.mockResolvedValue([
      { id: "ckassoc0000000000000000001", userId: "user-b", linkAcceptedAt: accepted },
      { id: "ckassoc0000000000000000002", userId: "user-c", linkAcceptedAt: accepted },
    ]);
    h.user.findUnique.mockImplementation(async ({ where }: { where: { username: string } }) =>
      ({ marie: { id: "user-b" }, paul: { id: "user-d" } })[where.username] ?? null,
    );
    await actions.saveCapTable(COMPANY, {
      totalParts: 100,
      associates: [
        { id: "ckassoc0000000000000000001", name: "Marie", parts: 50, username: "marie" },
        { id: "ckassoc0000000000000000002", name: "Paul", parts: 50, username: "paul" },
      ],
    });
    const updates = h.associate.update.mock.calls.map((c) => c[0].data);
    expect(updates[0]).toMatchObject({ userId: "user-b", linkAcceptedAt: accepted });
    // A new person in that row has not accepted anything yet.
    expect(updates[1]).toMatchObject({ userId: "user-d", linkAcceptedAt: null });
  });

  it("enforces the invariant before touching anything", async () => {
    await expect(
      actions.saveCapTable(COMPANY, { totalParts: 100, associates: [{ name: "A", parts: 60 }, { name: "B", parts: 30 }] }),
    ).resolves.toEqual({ ok: false, error: "parts_sum_mismatch" });
    expect(h.holding.deleteMany).not.toHaveBeenCalled();
  });
});

describe("respondToCompanyLink", () => {
  it("accepts only the caller's own pending row", async () => {
    h.viewer.id = "user-b";
    await actions.respondToCompanyLink("ckassoc0000000000000000001", true);
    expect(h.associate.updateMany).toHaveBeenCalledWith({
      where: { id: "ckassoc0000000000000000001", userId: "user-b", linkAcceptedAt: null },
      data: { linkAcceptedAt: expect.any(Date) },
    });
  });

  it("declines (or leaves) by unlinking the caller's own row, keeping the parts", async () => {
    h.viewer.id = "user-b";
    await actions.respondToCompanyLink("ckassoc0000000000000000001", false);
    expect(h.associate.updateMany).toHaveBeenCalledWith({
      where: { id: "ckassoc0000000000000000001", userId: "user-b" },
      data: { userId: null, linkAcceptedAt: null },
    });
  });

  it("says Not found. for anybody else's row", async () => {
    h.associate.updateMany.mockResolvedValue({ count: 0 });
    await expect(actions.respondToCompanyLink("ckassoc0000000000000000001", true)).rejects.toThrow("Not found.");
  });

  it("treats only a literal true as consent", async () => {
    await actions.respondToCompanyLink("ckassoc0000000000000000001", "yes" as unknown as boolean);
    expect(h.associate.updateMany.mock.calls[0][0].data).toEqual({ userId: null, linkAcceptedAt: null });
  });
});

describe("setAccountCompany", () => {
  const ACCOUNT = "ckaccount00000000000000001";

  it("only moves the caller's own account", async () => {
    h.account.findFirst.mockResolvedValue(null);
    await expect(actions.setAccountCompany(ACCOUNT, COMPANY)).rejects.toThrow("Not found.");
    expect(h.account.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ACCOUNT, userId: MANAGER } }));
  });

  it("refuses an account under a bank connection (the institution moves instead)", async () => {
    h.account.findFirst.mockResolvedValue({ companyId: null, institutionId: "inst-own", _count: { coOwners: 0 } });
    await expect(actions.setAccountCompany(ACCOUNT, COMPANY)).resolves.toEqual({ ok: false, error: "institution_account" });
  });

  it("refuses a co-owned account, which the co-owner would keep counting at 100 %", async () => {
    h.account.findFirst.mockResolvedValue({ companyId: null, institutionId: null, _count: { coOwners: 1 } });
    await expect(actions.setAccountCompany(ACCOUNT, COMPANY)).resolves.toEqual({ ok: false, error: "co_owned" });
    expect(h.account.update).not.toHaveBeenCalled();
  });

  it("moves a manual account in", async () => {
    h.account.findFirst.mockResolvedValue({ companyId: null, institutionId: null, _count: { coOwners: 0 } });
    await expect(actions.setAccountCompany(ACCOUNT, COMPANY)).resolves.toEqual({ ok: true });
    expect(h.account.update).toHaveBeenCalledWith({ where: { id: ACCOUNT }, data: { companyId: COMPANY } });
  });
});

describe("setInstitutionCompany", () => {
  it("moves the connection and every account under it together", async () => {
    h.institution.findUnique.mockResolvedValue({ companyId: null });
    h.coOwner.count.mockResolvedValue(0);
    await expect(actions.setInstitutionCompany("inst-own", COMPANY)).resolves.toEqual({ ok: true });
    expect(h.institution.update).toHaveBeenCalledWith({ where: { id: "inst-own" }, data: { companyId: COMPANY } });
    expect(h.account.updateMany).toHaveBeenCalledWith({ where: { institutionId: "inst-own" }, data: { companyId: COMPANY } });
  });

  it("refuses someone else's institution", async () => {
    await expect(actions.setInstitutionCompany("inst-other", COMPANY)).rejects.toThrow("Not found.");
  });
});

describe("transferCompanyManagement", () => {
  const NEXT = "ckassoc0000000000000000002";

  it("only hands over to an associate who accepted their link", async () => {
    h.associate.findFirst.mockResolvedValue(null);
    await expect(actions.transferCompanyManagement(COMPANY, NEXT)).resolves.toEqual({ ok: false, error: "not_an_associate" });
    expect(h.associate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY, linkAcceptedAt: { not: null } }) }),
    );
    expect(h.company.update).not.toHaveBeenCalled();
  });

  it("moves the company, its institutions and its accounts in one transaction", async () => {
    h.associate.findFirst.mockResolvedValue({ userId: "user-b" });
    await expect(actions.transferCompanyManagement(COMPANY, NEXT)).resolves.toEqual({ ok: true });
    expect(h.company.update).toHaveBeenCalledWith({ where: { id: COMPANY }, data: { managerUserId: "user-b" } });
    expect(h.institution.updateMany).toHaveBeenCalledWith({ where: { companyId: COMPANY }, data: { userId: "user-b" } });
    expect(h.account.updateMany).toHaveBeenCalledWith({ where: { companyId: COMPANY }, data: { userId: "user-b" } });
    expect(h.alertRule.deleteMany).toHaveBeenCalledWith({ where: { userId: MANAGER, accountId: { in: ["sci-bank"] } } });
  });

  it("reports an institution name clash instead of crashing", async () => {
    h.associate.findFirst.mockResolvedValue({ userId: "user-b" });
    h.transaction.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
    await expect(actions.transferCompanyManagement(COMPANY, NEXT)).resolves.toEqual({ ok: false, error: "name_conflict" });
  });
});

describe("deleteCompany", () => {
  it("returns the accounts to the manager's portfolio, then deletes", async () => {
    await actions.deleteCompany(COMPANY);
    expect(h.account.updateMany).toHaveBeenCalledWith({ where: { companyId: COMPANY }, data: { companyId: null } });
    expect(h.company.delete).toHaveBeenCalledWith({ where: { id: COMPANY } });
  });
});

describe("setViewingCompany", () => {
  it("stores the scope for an associate", async () => {
    h.viewer.id = "user-b";
    await actions.setViewingCompany(COMPANY);
    expect(h.cookieSet).toHaveBeenCalledWith("viewing_portfolio", `company:${COMPANY}`, expect.objectContaining({ httpOnly: true }));
  });

  it("refuses an outsider and stores nothing", async () => {
    h.viewer.id = "user-z";
    await expect(actions.setViewingCompany(COMPANY)).rejects.toThrow("Not found.");
    expect(h.cookieSet).not.toHaveBeenCalled();
  });

  it("refuses an operator object as the id", async () => {
    await expect(actions.setViewingCompany({ not: "x" } as unknown as string)).rejects.toThrow();
    expect(h.cookieSet).not.toHaveBeenCalled();
  });
});

describe("current accounts in the cap table", () => {
  it("are stored per associate, in cents", async () => {
    const input = valid();
    (input.associates[0] as { currentAccountCents?: number }).currentAccountCents = 30_000_00;
    await actions.createCompany(input);
    const [self, other] = h.associate.create.mock.calls.map((c) => c[0].data);
    expect(self.currentAccountCents).toBe(BigInt(30_000_00));
    expect(other.currentAccountCents).toBe(BigInt(0));
  });

  it("refuse a negative amount, writing nothing", async () => {
    const input = valid();
    (input.associates[1] as { currentAccountCents?: number }).currentAccountCents = -5;
    await expect(actions.createCompany(input)).resolves.toEqual({ ok: false, error: "current_account_invalid" });
    expect(h.company.create).not.toHaveBeenCalled();
  });

  it("are saved again with the cap table", async () => {
    h.associate.findMany.mockResolvedValue([{ id: "ckassoc0000000000000000001", userId: MANAGER, linkAcceptedAt: new Date() }]);
    await actions.saveCapTable(COMPANY, {
      totalParts: 10,
      associates: [{ id: "ckassoc0000000000000000001", name: "A", parts: 10, self: true, currentAccountCents: 12_345 }],
    });
    expect(h.associate.update.mock.calls[0][0].data.currentAccountCents).toBe(BigInt(12_345));
  });
});

describe("démembrement and discount in the actions (step 3)", () => {
  it("stores a block on both sides and the usufructuary's birth date", async () => {
    await actions.createCompany({
      name: "SCI Famille",
      kind: "SCI",
      taxRegime: "IR",
      totalParts: 1000,
      associates: [
        { name: "Parent", parts: 0, self: true, birthDate: "1956-01-01" },
        { name: "Enfant", parts: 0 },
      ],
      dismemberments: [{ parts: 1000, usufructuary: 0, bareOwner: 1 }],
    });
    expect(h.associate.create.mock.calls[0][0].data.birthDate?.toISOString()).toBe("1956-01-01T00:00:00.000Z");
    expect(h.holding.create.mock.calls.map((c) => c[0].data)).toEqual([
      { companyId: COMPANY, parts: 1000, usufructuaryId: "assoc-1", bareOwnerId: "assoc-2" },
    ]);
  });

  it("refuses a block without the usufructuary's birth date, writing nothing", async () => {
    await expect(
      actions.createCompany({
        name: "SCI",
        kind: "SCI",
        taxRegime: "IR",
        totalParts: 10,
        associates: [{ name: "P", parts: 0, self: true }, { name: "E", parts: 0 }],
        dismemberments: [{ parts: 10, usufructuary: 0, bareOwner: 1 }],
      }),
    ).resolves.toEqual({ ok: false, error: "birth_date_required" });
    expect(h.company.create).not.toHaveBeenCalled();
  });

  it.each([[-0.1], [1], [1.5], [Number.NaN], ["0.2"]])("refuses the discount %s", async (discountPct) => {
    await expect(
      actions.updateCompany(COMPANY, { name: "X", kind: "SCI", taxRegime: "IR", discountPct: discountPct as number }),
    ).resolves.toEqual({ ok: false, error: "discount_invalid" });
    expect(h.company.update).not.toHaveBeenCalled();
  });

  it("stores a valid discount, and none for 0", async () => {
    await actions.updateCompany(COMPANY, { name: "X", kind: "SCI", taxRegime: "IR", discountPct: 0.15 });
    expect(h.company.update.mock.calls[0][0].data.discountPct).toBeCloseTo(0.15, 10);
    await actions.updateCompany(COMPANY, { name: "X", kind: "SCI", taxRegime: "IR", discountPct: 0 });
    expect(h.company.update.mock.calls[1][0].data.discountPct).toBeNull();
  });
});

describe("setBuildingBookValue (step 4)", () => {
  const BUILDING = "ckaccount00000000000000009";

  it("stores the manager's figure, in cents", async () => {
    h.account.findUnique.mockResolvedValue({ companyId: COMPANY, type: "REAL_ESTATE" });
    await expect(actions.setBuildingBookValue(BUILDING, 150_000_00)).resolves.toEqual({ ok: true });
    expect(h.account.update).toHaveBeenCalledWith({ where: { id: BUILDING }, data: { bookValueCents: BigInt(150_000_00) } });
  });

  it("refuses an associate and an outsider alike", async () => {
    h.account.findUnique.mockResolvedValue({ companyId: COMPANY, type: "REAL_ESTATE" });
    h.viewer.id = "user-b";
    await expect(actions.setBuildingBookValue(BUILDING, 1)).rejects.toThrow("Not found.");
    h.viewer.id = "user-z";
    await expect(actions.setBuildingBookValue(BUILDING, 1)).rejects.toThrow("Not found.");
    expect(h.account.update).not.toHaveBeenCalled();
  });

  it("refuses anything but a company's building", async () => {
    h.account.findUnique.mockResolvedValue({ companyId: null, type: "REAL_ESTATE" });
    await expect(actions.setBuildingBookValue(BUILDING, 1)).rejects.toThrow("Not found.");
    h.account.findUnique.mockResolvedValue({ companyId: COMPANY, type: "CHECKING" });
    await expect(actions.setBuildingBookValue(BUILDING, 1)).rejects.toThrow("Not found.");
  });

  it.each([[-1], [10.5], ["100"]])("refuses the amount %s", async (amount) => {
    h.account.findUnique.mockResolvedValue({ companyId: COMPANY, type: "REAL_ESTATE" });
    await expect(actions.setBuildingBookValue(BUILDING, amount as number)).resolves.toEqual({ ok: false, error: "book_value_invalid" });
    expect(h.account.update).not.toHaveBeenCalled();
  });
});
