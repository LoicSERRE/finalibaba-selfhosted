import { beforeEach, describe, expect, it, vi } from "vitest";

// What the dashboard banner counts: only invitations addressed to this user
// and not answered yet - the same conditions as the places they are answered.

const h = vi.hoisted(() => ({ coOwner: vi.fn(), grant: vi.fn(), associate: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    accountCoOwner: { count: h.coOwner },
    portfolioGrant: { count: h.grant },
    companyAssociate: { count: h.associate },
  },
}));

const { countPendingInvitations } = await import("@/lib/services/pending-invitations");

beforeEach(() => {
  h.coOwner.mockResolvedValue(1);
  h.grant.mockResolvedValue(2);
  h.associate.mockResolvedValue(3);
});

describe("countPendingInvitations", () => {
  it("adds co-ownerships and grants as shares, company links apart", async () => {
    await expect(countPendingInvitations("user-b")).resolves.toEqual({ shares: 3, companies: 3 });
  });

  it("counts only this user's unanswered invitations", async () => {
    await countPendingInvitations("user-b");
    expect(h.coOwner).toHaveBeenCalledWith({ where: { userId: "user-b", acceptedAt: null } });
    expect(h.grant).toHaveBeenCalledWith({ where: { granteeUserId: "user-b", acceptedAt: null } });
    expect(h.associate).toHaveBeenCalledWith({ where: { userId: "user-b", linkAcceptedAt: null } });
  });
});
