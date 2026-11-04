import { beforeEach, describe, expect, it, vi } from "vitest";

// Which company a new account lands in (lib/services/company-guards.ts):
// the invariant that an account and its institution agree, and that only a
// company's manager can put an account in it.

const h = vi.hoisted(() => ({
  institutions: new Map<string, { companyId: string | null }>(),
  managers: new Map<string, string>(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    institution: { findUnique: async ({ where }: { where: { id: string } }) => h.institutions.get(where.id) ?? null },
  },
}));

vi.mock("@/lib/auth-context", () => ({
  assertCompanyManager: async (userId: string, companyId: string) => {
    if (h.managers.get(companyId) !== userId) throw new Error("Not found.");
  },
}));

const { companyForNewAccount } = await import("@/lib/services/company-guards");

const SCI = "ckcompany00000000000000001";

beforeEach(() => {
  h.institutions.clear();
  h.managers.clear();
  h.managers.set(SCI, "user-a");
  h.institutions.set("inst-sci", { companyId: SCI });
  h.institutions.set("inst-perso", { companyId: null });
});

describe("companyForNewAccount", () => {
  it("is nobody's company for a plain personal account", async () => {
    await expect(companyForNewAccount("user-a", undefined, null)).resolves.toBeNull();
    await expect(companyForNewAccount("user-a", "inst-perso", "")).resolves.toBeNull();
  });

  it("follows a company's bank connection without being asked", async () => {
    await expect(companyForNewAccount("user-a", "inst-sci", null)).resolves.toBe(SCI);
  });

  it("puts a manual account in the company its manager asks for", async () => {
    await expect(companyForNewAccount("user-a", undefined, SCI)).resolves.toBe(SCI);
  });

  it("refuses anyone but the manager", async () => {
    await expect(companyForNewAccount("user-b", undefined, SCI)).rejects.toThrow("Not found.");
  });

  it("refuses a company that disagrees with the account's institution", async () => {
    await expect(companyForNewAccount("user-a", "inst-perso", SCI)).rejects.toThrow("Not found.");
  });

  it("refuses an operator object as the company id", async () => {
    await expect(companyForNewAccount("user-a", undefined, { not: "x" })).rejects.toThrow();
  });
});
