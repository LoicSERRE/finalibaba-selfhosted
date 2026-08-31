import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The multi-user access layer (v2.0) - the one module every Server Action and
// page in the app now depends on for "who is asking" and "what may they
// touch". Covered against a mocked Prisma client, same shape as the other
// lib/actions tests in this directory (see __tests__/totp-actions.test.ts's
// own header for why that boundary is where it is).
//
// The properties asserted here are the ones a cross-user data leak would
// break first: mono mode always resolving to the owner (so an instance that
// never enables auth behaves exactly as it did before v2.0), baseAccountIds
// never including a merely-granted portfolio, viewAccountIds falling back to
// "own" rather than erroring on a stale grant, and every guard throwing an
// indistinguishable "not found" for someone else's id.

const {
  userFindUniqueMock,
  accountFindManyMock,
  accountCountMock,
  coOwnerFindManyMock,
  coOwnerCountMock,
  grantFindUniqueMock,
  categoryCountMock,
  goalCountMock,
  transactionCountMock,
  getServerSessionMock,
  cookieGetMock,
  cookiesMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  accountFindManyMock: vi.fn(),
  accountCountMock: vi.fn(),
  coOwnerFindManyMock: vi.fn(),
  coOwnerCountMock: vi.fn(),
  grantFindUniqueMock: vi.fn(),
  categoryCountMock: vi.fn(),
  goalCountMock: vi.fn(),
  transactionCountMock: vi.fn(),
  getServerSessionMock: vi.fn(),
  cookieGetMock: vi.fn(),
  cookiesMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock },
    account: { findMany: accountFindManyMock, count: accountCountMock },
    accountCoOwner: { findMany: coOwnerFindManyMock, count: coOwnerCountMock },
    portfolioGrant: { findUnique: grantFindUniqueMock },
    category: { count: categoryCountMock },
    goal: { count: goalCountMock },
    transaction: { count: transactionCountMock },
  },
}));

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import {
  getViewer,
  requireAdmin,
  baseAccountIds,
  viewAccountIds,
  assertAccountWritable,
  assertOwned,
  assertTransactionsWritable,
  getViewContext,
  isDeletedSessionUser,
  DeletedSessionUserError,
  OWNER_USER_ID,
} from "@/lib/auth-context";

const OWNER = { id: OWNER_USER_ID, role: "ADMIN" as const };
const MEMBER = { id: "user-b", role: "MEMBER" as const };

beforeEach(() => {
  for (const m of [
    userFindUniqueMock,
    accountFindManyMock,
    accountCountMock,
    coOwnerFindManyMock,
    coOwnerCountMock,
    grantFindUniqueMock,
    categoryCountMock,
    goalCountMock,
    transactionCountMock,
    getServerSessionMock,
    cookieGetMock,
  ]) {
    m.mockReset();
  }
  cookiesMock.mockResolvedValue({ get: cookieGetMock });
  delete process.env.AUTH_ENABLED;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.AUTH_ENABLED;
});

describe("getViewer", () => {
  it("resolves to the owner without touching the session when auth is disabled", async () => {
    userFindUniqueMock.mockResolvedValue(OWNER);

    const viewer = await getViewer();

    expect(viewer).toEqual({ id: OWNER_USER_ID, role: "ADMIN", isMonoMode: true });
    // The whole mono-mode guarantee rests on this: no login, no session read,
    // one uniform code path with the owner standing in for "the user".
    expect(getServerSessionMock).not.toHaveBeenCalled();
  });

  it("resolves the session's own user when auth is enabled", async () => {
    process.env.AUTH_ENABLED = "true";
    getServerSessionMock.mockResolvedValue({ user: { id: "user-b" } });
    userFindUniqueMock.mockResolvedValue(MEMBER);

    await expect(getViewer()).resolves.toEqual({ id: "user-b", role: "MEMBER", isMonoMode: false });
    expect(userFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-b" } })
    );
  });

  it("maps a pre-v2 session with no userId onto the owner instead of logging it out", async () => {
    process.env.AUTH_ENABLED = "true";
    // The old JWT only ever carried sub: "owner" - a browser holding one
    // across the upgrade must keep working rather than 500 or bounce to login.
    getServerSessionMock.mockResolvedValue({ user: {} });
    userFindUniqueMock.mockResolvedValue(OWNER);

    await expect(getViewer()).resolves.toEqual({
      id: OWNER_USER_ID,
      role: "ADMIN",
      isMonoMode: false,
    });
  });

  it("throws a diagnosable error when the owner row is missing entirely", async () => {
    userFindUniqueMock.mockResolvedValue(null);
    await expect(getViewer()).rejects.toThrow(/multi-user migration/);
  });
});

describe("requireAdmin", () => {
  it("rejects a MEMBER", async () => {
    process.env.AUTH_ENABLED = "true";
    getServerSessionMock.mockResolvedValue({ user: { id: "user-b" } });
    userFindUniqueMock.mockResolvedValue(MEMBER);

    await expect(requireAdmin()).rejects.toThrow("Admin access required.");
  });

  it("accepts an ADMIN", async () => {
    userFindUniqueMock.mockResolvedValue(OWNER);
    await expect(requireAdmin()).resolves.toMatchObject({ role: "ADMIN" });
  });
});

describe("baseAccountIds", () => {
  it("unions owned and co-owned accounts, de-duplicating", async () => {
    accountFindManyMock.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
    coOwnerFindManyMock.mockResolvedValue([{ accountId: "a2" }, { accountId: "joint" }]);

    await expect(baseAccountIds("user-b")).resolves.toEqual(["a1", "a2", "joint"]);
  });

  it("queries only the given user's rows", async () => {
    accountFindManyMock.mockResolvedValue([]);
    coOwnerFindManyMock.mockResolvedValue([]);

    await baseAccountIds("user-b");

    expect(accountFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-b" } })
    );
    expect(coOwnerFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-b" } })
    );
  });
});

describe("viewAccountIds", () => {
  it("returns the viewer's own set when no portfolio is being viewed", async () => {
    accountFindManyMock.mockResolvedValue([{ id: "a1" }]);
    coOwnerFindManyMock.mockResolvedValue([]);

    await expect(viewAccountIds("user-b")).resolves.toEqual(["a1"]);
    expect(grantFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns the grantor's set when a real grant exists", async () => {
    grantFindUniqueMock.mockResolvedValue({ role: "READ" });
    accountFindManyMock.mockResolvedValue([{ id: "owner-1" }]);
    coOwnerFindManyMock.mockResolvedValue([]);

    await expect(viewAccountIds("user-b", OWNER_USER_ID)).resolves.toEqual(["owner-1"]);
    expect(accountFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: OWNER_USER_ID } })
    );
  });

  it("silently falls back to the viewer's own set when the grant is gone", async () => {
    // A revoked grant with a stale cookie still pointing at it must degrade to
    // "my own portfolio", never to the grantor's data and never to an error
    // page - the switcher's selection is caller-supplied state, not a claim.
    grantFindUniqueMock.mockResolvedValue(null);
    accountFindManyMock.mockResolvedValue([{ id: "b1" }]);
    coOwnerFindManyMock.mockResolvedValue([]);

    await expect(viewAccountIds("user-b", OWNER_USER_ID)).resolves.toEqual(["b1"]);
    expect(accountFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-b" } })
    );
  });
});

describe("assertAccountWritable", () => {
  it("passes for an owned account", async () => {
    accountCountMock.mockResolvedValue(1);
    coOwnerCountMock.mockResolvedValue(0);
    await expect(assertAccountWritable("user-b", "a1")).resolves.toBeUndefined();
  });

  it("passes for a co-owned account the user doesn't own outright", async () => {
    accountCountMock.mockResolvedValue(0);
    coOwnerCountMock.mockResolvedValue(1);
    await expect(assertAccountWritable("user-b", "joint")).resolves.toBeUndefined();
  });

  it("throws for another user's account", async () => {
    accountCountMock.mockResolvedValue(0);
    coOwnerCountMock.mockResolvedValue(0);
    await expect(assertAccountWritable("user-b", "owner-1")).rejects.toThrow("Account not found.");
  });
});

describe("assertOwned", () => {
  it("scopes the lookup by userId, not just id", async () => {
    categoryCountMock.mockResolvedValue(1);
    await assertOwned("category", "cat-1", "user-b");
    expect(categoryCountMock).toHaveBeenCalledWith({ where: { id: "cat-1", userId: "user-b" } });
  });

  it("throws an identical error for a missing row and for someone else's row", async () => {
    // Deliberately indistinguishable: a different message would confirm the
    // existence of another user's data to anyone enumerating ids.
    goalCountMock.mockResolvedValue(0);
    const missing = await assertOwned("goal", "does-not-exist", "user-b").catch((e: Error) => e.message);
    const foreign = await assertOwned("goal", "owner-goal", "user-b").catch((e: Error) => e.message);
    expect(missing).toBe("Not found.");
    expect(foreign).toBe("Not found.");
  });
});

describe("assertTransactionsWritable", () => {
  it("is a no-op for an empty batch", async () => {
    await expect(assertTransactionsWritable("user-b", [])).resolves.toBeUndefined();
    expect(transactionCountMock).not.toHaveBeenCalled();
  });

  it("passes when every id resolves inside the user's own accounts", async () => {
    accountFindManyMock.mockResolvedValue([{ id: "a1" }]);
    coOwnerFindManyMock.mockResolvedValue([]);
    transactionCountMock.mockResolvedValue(2);

    await expect(assertTransactionsWritable("user-b", ["t1", "t2"])).resolves.toBeUndefined();
  });

  it("rejects the whole batch when one forged id rides along with legitimate ones", async () => {
    // The failure mode this exists for: a bulk categorization payload where
    // most ids are the caller's own and one belongs to someone else. A
    // per-id filter would silently drop it; this refuses the batch outright.
    accountFindManyMock.mockResolvedValue([{ id: "a1" }]);
    coOwnerFindManyMock.mockResolvedValue([]);
    transactionCountMock.mockResolvedValue(2);

    await expect(assertTransactionsWritable("user-b", ["t1", "t2", "foreign"])).rejects.toThrow(
      "Not found."
    );
  });

  it("counts distinct ids, so a duplicated id can't pad the batch to passing", async () => {
    accountFindManyMock.mockResolvedValue([{ id: "a1" }]);
    coOwnerFindManyMock.mockResolvedValue([]);
    // Prisma counts rows, not arguments: ["t1","t1","foreign"] matches 1 row.
    transactionCountMock.mockResolvedValue(1);

    await expect(assertTransactionsWritable("user-b", ["t1", "t1", "foreign"])).rejects.toThrow(
      "Not found."
    );
  });
});

describe("getViewContext (the portfolio switcher's read path)", () => {
  it("returns the viewer's own portfolio, writable, when no cookie is set", async () => {
    userFindUniqueMock.mockResolvedValue(OWNER);
    cookieGetMock.mockReturnValue(undefined);
    accountFindManyMock.mockResolvedValue([{ id: "a1" }]);
    coOwnerFindManyMock.mockResolvedValue([]);

    const ctx = await getViewContext();

    expect(ctx.ownerId).toBe(OWNER_USER_ID);
    expect(ctx.accountIds).toEqual(["a1"]);
    expect(ctx.readOnly).toBe(false);
    expect(grantFindUniqueMock).not.toHaveBeenCalled();
  });

  it("switches ownerId and accountIds to the grantor, read-only, for a real grant", async () => {
    process.env.AUTH_ENABLED = "true";
    getServerSessionMock.mockResolvedValue({ user: { id: "user-b" } });
    userFindUniqueMock.mockResolvedValue(MEMBER);
    cookieGetMock.mockReturnValue({ value: OWNER_USER_ID });
    grantFindUniqueMock.mockResolvedValue({ grantorUserId: OWNER_USER_ID });
    accountFindManyMock.mockResolvedValue([{ id: "owner-1" }]);
    coOwnerFindManyMock.mockResolvedValue([]);

    const ctx = await getViewContext();

    // ownerId is what user-scoped reads (categories, goals, settings) follow -
    // without it the grantor's transactions would render against the viewer's
    // own categories and look uncategorized.
    expect(ctx.ownerId).toBe(OWNER_USER_ID);
    expect(ctx.accountIds).toEqual(["owner-1"]);
    expect(ctx.readOnly).toBe(true);
  });

  it("falls back to the viewer's own writable portfolio when the grant is revoked", async () => {
    process.env.AUTH_ENABLED = "true";
    getServerSessionMock.mockResolvedValue({ user: { id: "user-b" } });
    userFindUniqueMock.mockResolvedValue(MEMBER);
    cookieGetMock.mockReturnValue({ value: OWNER_USER_ID });
    grantFindUniqueMock.mockResolvedValue(null);
    accountFindManyMock.mockResolvedValue([{ id: "b1" }]);
    coOwnerFindManyMock.mockResolvedValue([]);

    const ctx = await getViewContext();

    // A stale cookie is an everyday state (revoked while a tab sat open), so
    // it degrades rather than erroring - and crucially lands back in
    // read-WRITE mode on the viewer's own data, not read-only limbo.
    expect(ctx.ownerId).toBe("user-b");
    expect(ctx.accountIds).toEqual(["b1"]);
    expect(ctx.readOnly).toBe(false);
  });

  it("ignores a cookie naming the viewer themselves", async () => {
    userFindUniqueMock.mockResolvedValue(OWNER);
    cookieGetMock.mockReturnValue({ value: OWNER_USER_ID });
    accountFindManyMock.mockResolvedValue([]);
    coOwnerFindManyMock.mockResolvedValue([]);

    const ctx = await getViewContext();

    expect(ctx.readOnly).toBe(false);
    expect(grantFindUniqueMock).not.toHaveBeenCalled();
  });
});

// Reported from a real instance, and the worst bug this codebase has had: an
// admin deleted a member's account while that member had a tab open, and the
// member's next refresh logged them in AS THE ADMIN. The session cookie stays
// cryptographically valid for its full 30 days, so the browser kept sending
// it; the lookup for the deleted id returned null, and getViewer fell through
// to the owner block - which returns role "ADMIN" and the owner's id. Full
// read/write over the entire instance, from an account that no longer existed.
//
// The owner fallback must be unreachable whenever a session names a user.
describe("getViewer with a session for a user that no longer exists", () => {
  beforeEach(() => {
    process.env.AUTH_ENABLED = "true";
    getServerSessionMock.mockResolvedValue({ user: { id: "user-deleted" } });
  });

  it("refuses rather than falling back to the owner", async () => {
    userFindUniqueMock.mockResolvedValue(null);

    await expect(getViewer()).rejects.toBeInstanceOf(DeletedSessionUserError);
  });

  it("never looks the owner up at all, so it cannot return that identity", async () => {
    // The precise regression: the second findUnique, for OWNER_USER_ID, was
    // what handed over the admin identity. It must not happen.
    userFindUniqueMock.mockResolvedValue(null);

    await expect(getViewer()).rejects.toThrow();
    expect(userFindUniqueMock).toHaveBeenCalledTimes(1);
    expect(userFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-deleted" } }),
    );
  });

  it("throws even when the owner row is perfectly fine", async () => {
    // Guards against a fix that only works because the owner lookup fails too.
    userFindUniqueMock.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === OWNER_USER_ID ? OWNER : null,
    );

    await expect(getViewer()).rejects.toBeInstanceOf(DeletedSessionUserError);
  });

  it("is recognisable to the layout, which is the only caller allowed to swallow it", async () => {
    userFindUniqueMock.mockResolvedValue(null);

    const caught = await getViewer().catch((e) => e);
    expect(isDeletedSessionUser(caught)).toBe(true);
    // A genuinely broken install must stay distinguishable from this.
    expect(isDeletedSessionUser(new Error("No owner user found"))).toBe(false);
  });

  it("blocks requireAdmin too, rather than granting it", async () => {
    userFindUniqueMock.mockResolvedValue(null);

    await expect(requireAdmin()).rejects.toBeInstanceOf(DeletedSessionUserError);
  });
});
