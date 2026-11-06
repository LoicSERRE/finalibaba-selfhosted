import { beforeEach, describe, expect, it, vi } from "vitest";
import { isLocalHostname, isPrivateAddress } from "@/lib/domain/network-address";

// The instance's own mail relay signs with its domain and asks for no
// credentials: only the admin's alerts may go through it, or through anything
// else on the instance's network.

const h = vi.hoisted(() => ({ role: "MEMBER" as "ADMIN" | "MEMBER" | null, dns: new Map<string, string[]>() }));

vi.mock("@/lib/db/prisma", () => ({
  prisma: { user: { findUnique: async () => (h.role ? { role: h.role } : null) } },
}));
vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) => {
    const addresses = h.dns.get(host);
    if (!addresses) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  },
}));

const { smtpHostAllowedFor } = await import("@/lib/services/smtp-relay-policy");

beforeEach(() => {
  h.role = "MEMBER";
  h.dns = new Map([
    ["smtp.gmail.com", ["142.250.102.108", "2a00:1450:4013:c00::6c"]],
    ["mail.instance.example", ["172.18.0.5"]],
    ["mixed.example", ["93.184.216.34", "10.0.0.7"]],
  ]);
});

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.10", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "::1", "::", "fd12:3456::1", "fc00::1", "fe80::1", "::ffff:192.168.1.1",
  ])("%s is private", (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(["8.8.8.8", "172.32.0.1", "172.15.0.1", "100.128.0.1", "2a00:1450::1", "::ffff:8.8.8.8", "mail"])(
    "%s is not",
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe("isLocalHostname", () => {
  it.each(["mail", "MAIL", "sync", "localhost", "foo.localhost", "mail."])("%s is local", (host) =>
    expect(isLocalHostname(host)).toBe(true),
  );
  it.each(["smtp.gmail.com", "mail.instance.example", "8.8.8.8"])("%s is not", (host) =>
    expect(isLocalHostname(host)).toBe(false),
  );
});

describe("smtpHostAllowedFor", () => {
  it("lets the admin use the instance's own relay", async () => {
    h.role = "ADMIN";
    await expect(smtpHostAllowedFor("owner", "mail")).resolves.toBe(true);
    await expect(smtpHostAllowedFor("owner", "10.0.0.2")).resolves.toBe(true);
  });

  it("lets a member use a public provider", async () => {
    await expect(smtpHostAllowedFor("member", "smtp.gmail.com")).resolves.toBe(true);
    await expect(smtpHostAllowedFor("member", "8.8.8.8")).resolves.toBe(true);
  });

  it.each([
    ["the mail service by name", "mail"],
    ["loopback", "127.0.0.1"],
    ["a private address", "172.18.0.5"],
    ["a public name resolving inside", "mail.instance.example"],
    ["a name with one private address among public ones", "mixed.example"],
    ["a name that does not resolve", "nowhere.invalid"],
  ])("refuses a member %s", async (_label, host) => {
    await expect(smtpHostAllowedFor("member", host)).resolves.toBe(false);
  });

  it("refuses a user who does not exist", async () => {
    h.role = null;
    await expect(smtpHostAllowedFor("ghost", "smtp.gmail.com")).resolves.toBe(false);
  });
});
