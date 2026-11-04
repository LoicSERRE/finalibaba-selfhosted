import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The two v2.0 sharing mechanisms (co-ownership and portfolio grants), tested
// against a mocked Prisma client - same lib/actions boundary as the other
// action tests here (see __tests__/totp-actions.test.ts's header).
//
// What's asserted is what a sharing bug would break first: that only an
// account's DIRECT owner can manage its co-owners, that removing one cleans up
// the rows no FK cascade will ever reach (H4), and that the portfolio-switcher
// cookie is only ever written for a grant that actually exists (H6).

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const {
  accountCountMock,
  userFindUniqueMock,
  coOwnerFindManyMock,
  coOwnerUpsertMock,
  coOwnerDeleteManyMock,
  alertRuleDeleteManyMock,
  goalDeleteManyMock,
  grantFindUniqueMock,
  grantUpsertMock,
  grantDeleteManyMock,
  transactionMock,
  getViewerMock,
  cookieSetMock,
  cookieDeleteMock,
  coOwnerUpdateManyMock,
  grantUpdateManyMock,
} = vi.hoisted(() => ({
  accountCountMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  coOwnerFindManyMock: vi.fn(),
  coOwnerUpsertMock: vi.fn(),
  coOwnerDeleteManyMock: vi.fn(),
  alertRuleDeleteManyMock: vi.fn(),
  goalDeleteManyMock: vi.fn(),
  grantFindUniqueMock: vi.fn(),
  grantUpsertMock: vi.fn(),
  grantDeleteManyMock: vi.fn(),
  transactionMock: vi.fn((ops: unknown[]) => Promise.all(ops)),
  getViewerMock: vi.fn(async () => ({ id: "user-a", role: "MEMBER", isMonoMode: false })),
  cookieSetMock: vi.fn(),
  cookieDeleteMock: vi.fn(),
  coOwnerUpdateManyMock: vi.fn(),
  grantUpdateManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    account: { count: accountCountMock },
    user: { findUnique: userFindUniqueMock },
    accountCoOwner: {
      findMany: coOwnerFindManyMock,
      upsert: coOwnerUpsertMock,
      deleteMany: coOwnerDeleteManyMock,
      updateMany: coOwnerUpdateManyMock,
    },
    alertRule: { deleteMany: alertRuleDeleteManyMock },
    goal: { deleteMany: goalDeleteManyMock },
    portfolioGrant: {
      findUnique: grantFindUniqueMock,
      findMany: vi.fn(async () => []),
      upsert: grantUpsertMock,
      deleteMany: grantDeleteManyMock,
      updateMany: grantUpdateManyMock,
    },
    $transaction: transactionMock,
  },
}));

vi.mock("@/lib/auth-context", () => ({
  getViewer: getViewerMock,
  VIEWING_PORTFOLIO_COOKIE: "viewing_portfolio",
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: cookieSetMock, delete: cookieDeleteMock })),
}));

import {
  addAccountCoOwner,
  removeAccountCoOwner,
  grantPortfolioAccess,
  revokePortfolioGrant,
  setViewingPortfolio,
  respondToCoOwnership,
  respondToPortfolioGrant,
} from "@/lib/actions/sharing";

const formWith = (username: string) => {
  const fd = new FormData();
  fd.set("username", username);
  return fd;
};

beforeEach(() => {
  for (const m of [
    accountCountMock,
    userFindUniqueMock,
    coOwnerFindManyMock,
    coOwnerUpsertMock,
    coOwnerDeleteManyMock,
    alertRuleDeleteManyMock,
    goalDeleteManyMock,
    grantFindUniqueMock,
    grantUpsertMock,
    grantDeleteManyMock,
    cookieSetMock,
    cookieDeleteMock,
    coOwnerUpdateManyMock,
    grantUpdateManyMock,
  ]) {
    m.mockReset();
  }
  transactionMock.mockClear();
  getViewerMock.mockResolvedValue({ id: "user-a", role: "MEMBER", isMonoMode: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("addAccountCoOwner", () => {
  it("refuses when the caller is not the account's direct owner", async () => {
    accountCountMock.mockResolvedValue(0); // not owned by user-a

    await expect(addAccountCoOwner("acc-1", formWith("bob"))).rejects.toThrow("Not found.");
    expect(coOwnerUpsertMock).not.toHaveBeenCalled();
    // The username is never even resolved - no lookup happens before the
    // ownership check, so this can't be used to probe who exists.
    expect(userFindUniqueMock).not.toHaveBeenCalled();
  });

  it("scopes the ownership check to the caller, not just the account id", async () => {
    accountCountMock.mockResolvedValue(1);
    userFindUniqueMock.mockResolvedValue({ id: "user-b" });
    coOwnerUpsertMock.mockResolvedValue({});

    await addAccountCoOwner("acc-1", formWith("bob"));

    expect(accountCountMock).toHaveBeenCalledWith({ where: { id: "acc-1", userId: "user-a" } });
  });

  it("upserts rather than creating, so re-adding an existing co-owner is a no-op", async () => {
    accountCountMock.mockResolvedValue(1);
    userFindUniqueMock.mockResolvedValue({ id: "user-b" });
    coOwnerUpsertMock.mockResolvedValue({});

    await addAccountCoOwner("acc-1", formWith("bob"));

    expect(coOwnerUpsertMock).toHaveBeenCalledWith({
      where: { accountId_userId: { accountId: "acc-1", userId: "user-b" } },
      create: { accountId: "acc-1", userId: "user-b" },
      update: {},
    });
  });

  it("rejects an unknown username", async () => {
    accountCountMock.mockResolvedValue(1);
    userFindUniqueMock.mockResolvedValue(null);

    // Returned, not thrown: production replaces a thrown Server Action error
    // with an opaque digest, so "no such user" reached the screen as an
    // unreadable internal error. The key is what the UI translates.
    await expect(addAccountCoOwner("acc-1", formWith("ghost"))).resolves.toEqual({
      ok: false,
      error: "no_such_user",
    });
    expect(coOwnerUpsertMock).not.toHaveBeenCalled();
  });

  it("rejects adding yourself", async () => {
    accountCountMock.mockResolvedValue(1);
    userFindUniqueMock.mockResolvedValue({ id: "user-a" });

    await expect(addAccountCoOwner("acc-1", formWith("me"))).resolves.toEqual({
      ok: false,
      error: "that_is_you",
    });
    expect(coOwnerUpsertMock).not.toHaveBeenCalled();
  });

  it("normalizes the username before looking it up", async () => {
    accountCountMock.mockResolvedValue(1);
    userFindUniqueMock.mockResolvedValue({ id: "user-b" });
    coOwnerUpsertMock.mockResolvedValue({});

    await addAccountCoOwner("acc-1", formWith("  BoB  "));

    expect(userFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { username: "bob" } })
    );
  });
});

describe("removeAccountCoOwner (H4 cleanup)", () => {
  it("deletes the removed user's rules and goals for that account, in one transaction", async () => {
    accountCountMock.mockResolvedValue(1);
    alertRuleDeleteManyMock.mockResolvedValue({ count: 1 });
    goalDeleteManyMock.mockResolvedValue({ count: 1 });
    coOwnerDeleteManyMock.mockResolvedValue({ count: 1 });

    await removeAccountCoOwner("acc-1", "user-b");

    // No FK cascade can fire here - the account survives - so an alert rule
    // left behind would keep notifying user-b about a balance they can no
    // longer see anywhere.
    expect(alertRuleDeleteManyMock).toHaveBeenCalledWith({
      where: { userId: "user-b", accountId: "acc-1" },
    });
    expect(goalDeleteManyMock).toHaveBeenCalledWith({
      where: { userId: "user-b", accountId: "acc-1" },
    });
    expect(coOwnerDeleteManyMock).toHaveBeenCalledWith({
      where: { accountId: "acc-1", userId: "user-b" },
    });
    expect(transactionMock).toHaveBeenCalledTimes(1);
  });

  it("never touches the account owner's own rules or goals", async () => {
    accountCountMock.mockResolvedValue(1);
    alertRuleDeleteManyMock.mockResolvedValue({ count: 0 });
    goalDeleteManyMock.mockResolvedValue({ count: 0 });
    coOwnerDeleteManyMock.mockResolvedValue({ count: 1 });

    await removeAccountCoOwner("acc-1", "user-b");

    for (const call of [...alertRuleDeleteManyMock.mock.calls, ...goalDeleteManyMock.mock.calls]) {
      expect(call[0].where.userId).toBe("user-b");
    }
  });

  it("refuses for a non-owner, without deleting anything", async () => {
    accountCountMock.mockResolvedValue(0);

    await expect(removeAccountCoOwner("acc-1", "user-b")).rejects.toThrow("Not found.");
    expect(transactionMock).not.toHaveBeenCalled();
    expect(alertRuleDeleteManyMock).not.toHaveBeenCalled();
  });

  // The exact operator-injection payload proven in the audit (F29): both ids
  // as Prisma operator objects turned the ownership count into its inverse and
  // deleted another user's rules plus every co-ownership of the instance. Both
  // args must be narrowed to strings before any query runs.
  it.each([
    [{ not: "x" }, "user-b"],
    ["acc-1", { not: "x" }],
  ])("rejects an operator-object id before touching the database (%o, %o)", async (accountId, userId) => {
    await expect(
      removeAccountCoOwner(accountId as unknown as string, userId as unknown as string),
    ).rejects.toThrow();
    expect(accountCountMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    expect(coOwnerDeleteManyMock).not.toHaveBeenCalled();
  });
});

describe("portfolio grants", () => {
  it("records the grant with the caller as grantor", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "user-b" });
    grantUpsertMock.mockResolvedValue({});

    await grantPortfolioAccess(formWith("bob"));

    expect(grantUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { grantorUserId: "user-a", granteeUserId: "user-b" },
      })
    );
  });

  it("revokes only grants the caller themselves gave", async () => {
    grantDeleteManyMock.mockResolvedValue({ count: 1 });

    await revokePortfolioGrant("user-b");

    // Scoped by grantorUserId: you can't revoke a grant between two other
    // people by naming its grantee.
    expect(grantDeleteManyMock).toHaveBeenCalledWith({
      where: { grantorUserId: "user-a", granteeUserId: "user-b" },
    });
  });
});

describe("setViewingPortfolio (H6)", () => {
  it("writes the cookie only when a real grant backs it", async () => {
    grantFindUniqueMock.mockResolvedValue({ grantorUserId: "user-b" });

    await setViewingPortfolio("user-b");

    expect(grantFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          grantorUserId_granteeUserId: { grantorUserId: "user-b", granteeUserId: "user-a" },
          acceptedAt: { not: null },
        },
      })
    );
    expect(cookieSetMock).toHaveBeenCalledWith(
      "viewing_portfolio",
      "user-b",
      expect.objectContaining({ httpOnly: true, sameSite: "lax" })
    );
  });

  it("refuses a portfolio nobody granted, and writes nothing", async () => {
    grantFindUniqueMock.mockResolvedValue(null);

    await expect(setViewingPortfolio("user-c")).rejects.toThrow("Not found.");
    expect(cookieSetMock).not.toHaveBeenCalled();
  });

  it("clears the cookie for null", async () => {
    await setViewingPortfolio(null);

    expect(cookieDeleteMock).toHaveBeenCalledWith("viewing_portfolio");
    expect(cookieSetMock).not.toHaveBeenCalled();
    expect(grantFindUniqueMock).not.toHaveBeenCalled();
  });

  it("clears the cookie when asked to view your own portfolio", async () => {
    await setViewingPortfolio("user-a");

    expect(cookieDeleteMock).toHaveBeenCalledWith("viewing_portfolio");
    expect(grantFindUniqueMock).not.toHaveBeenCalled();
  });
});

// The one thing the returned key must not become: a way to enumerate accounts.
// The message is now readable, which is the point - but readable to whom is
// the question, and this path is already noted as a username oracle in
// CLAUDE.md's post-v2.0 audit. Pinning the shape here so a future change has
// to face that decision deliberately rather than drift into it.
describe("share failures carry a key, never a name", () => {
  it("never echoes the username that was looked up", async () => {
    userFindUniqueMock.mockResolvedValue(null);
    accountCountMock.mockResolvedValue(1);

    const result = await addAccountCoOwner("acc-1", formWith("someone-elses-login"));

    expect(JSON.stringify(result)).not.toContain("someone-elses-login");
  });

  it("uses the same key whatever the unknown name was", async () => {
    userFindUniqueMock.mockResolvedValue(null);
    accountCountMock.mockResolvedValue(1);

    const a = await addAccountCoOwner("acc-1", formWith("ghost-one"));
    const b = await addAccountCoOwner("acc-1", formWith("ghost-two"));

    expect(a).toEqual(b);
  });

  it("distinguishes an empty input from an unknown user", async () => {
    // Different mistakes deserve different guidance, and neither reveals
    // anything: one is about the form, the other about this instance.
    accountCountMock.mockResolvedValue(1);
    userFindUniqueMock.mockResolvedValue(null);

    await expect(addAccountCoOwner("acc-1", formWith("  "))).resolves.toEqual({
      ok: false,
      error: "username_required",
    });
  });
});

describe("invitations: a share waits for the invited user (F6)", () => {
  it("creates a co-ownership pending, never accepted on the inviter's say-so", async () => {
    accountCountMock.mockResolvedValue(1);
    userFindUniqueMock.mockResolvedValue({ id: "user-b" });
    await addAccountCoOwner("acc-1", formWith("bob"));
    const { create } = coOwnerUpsertMock.mock.calls[0][0];
    expect(create).toEqual({ accountId: "acc-1", userId: "user-b" });
    expect(create).not.toHaveProperty("acceptedAt");
  });

  it("creates a portfolio grant pending too", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "user-b" });
    await grantPortfolioAccess(formWith("bob"));
    expect(grantUpsertMock.mock.calls[0][0].create).not.toHaveProperty("acceptedAt");
  });

  it("accepts only the viewer's own pending co-ownership", async () => {
    coOwnerUpdateManyMock.mockResolvedValue({ count: 1 });
    await respondToCoOwnership("acc-1", true);
    expect(coOwnerUpdateManyMock).toHaveBeenCalledWith({
      where: { accountId: "acc-1", userId: "user-a", acceptedAt: null },
      data: { acceptedAt: expect.any(Date) },
    });
  });

  it("declines by deleting only that pending row", async () => {
    coOwnerDeleteManyMock.mockResolvedValue({ count: 1 });
    await respondToCoOwnership("acc-1", false);
    expect(coOwnerDeleteManyMock).toHaveBeenCalledWith({
      where: { accountId: "acc-1", userId: "user-a", acceptedAt: null },
    });
    expect(coOwnerUpdateManyMock).not.toHaveBeenCalled();
  });

  it("says not found when there is nothing pending for the viewer", async () => {
    // Someone else's invitation, an accepted one, or none at all: same answer.
    coOwnerUpdateManyMock.mockResolvedValue({ count: 0 });
    await expect(respondToCoOwnership("acc-1", true)).rejects.toThrow("Not found.");
    grantDeleteManyMock.mockResolvedValue({ count: 0 });
    await expect(respondToPortfolioGrant("user-b", false)).rejects.toThrow("Not found.");
  });

  it("accepts only a grant addressed to the viewer", async () => {
    grantUpdateManyMock.mockResolvedValue({ count: 1 });
    await respondToPortfolioGrant("user-b", true);
    expect(grantUpdateManyMock).toHaveBeenCalledWith({
      where: { grantorUserId: "user-b", granteeUserId: "user-a", acceptedAt: null },
      data: { acceptedAt: expect.any(Date) },
    });
  });

  it.each([
    ["an operator object", { not: "x" }],
    ["an empty string", ""],
  ])("refuses %s as an id before touching the database", async (_label, bad) => {
    await expect(respondToCoOwnership(bad as unknown as string, true)).rejects.toThrow();
    await expect(respondToPortfolioGrant(bad as unknown as string, true)).rejects.toThrow();
    expect(coOwnerUpdateManyMock).not.toHaveBeenCalled();
    expect(grantUpdateManyMock).not.toHaveBeenCalled();
  });

  it("only treats a literal true as acceptance", async () => {
    // A truthy non-boolean must not accept: the argument comes from the client.
    coOwnerDeleteManyMock.mockResolvedValue({ count: 1 });
    await respondToCoOwnership("acc-1", "yes" as unknown as boolean);
    expect(coOwnerUpdateManyMock).not.toHaveBeenCalled();
  });
});
