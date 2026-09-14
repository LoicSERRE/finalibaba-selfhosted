import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The audit log's design decision is that it must never break the action it
 * describes - a full disk degrades the record, not the login. That is stated
 * in the module's own comment and is exactly the kind of property that a
 * refactor removes without anything failing: the happy path is identical
 * either way, and the difference only shows up on the day the database is
 * already in trouble.
 *
 * The IP tests are here for a narrower reason: it is recorded as evidence and
 * nothing authorises on it, so a wrong value is never caught by a broken
 * permission - only by reading the table months later and finding the proxy's
 * own address on every row.
 */

const h = vi.hoisted(() => {
  const rows: Record<string, unknown>[] = [];
  const state = { failEveryWrite: false, headers: new Map<string, string>(), noRequest: false };
  return { rows, state };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (h.state.failEveryWrite) throw new Error("disk full");
        h.rows.push(data);
        return data;
      },
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => {
    // Outside a request scope next/headers throws rather than returning empty.
    if (h.state.noRequest) throw new Error("called outside a request scope");
    return { get: (name: string) => h.state.headers.get(name) ?? null };
  },
}));

const { AUDIT, recordAuditEvent } = await import("@/lib/services/audit-log");

beforeEach(() => {
  h.rows.length = 0;
  h.state.failEveryWrite = false;
  h.state.noRequest = false;
  h.state.headers = new Map();
});

describe("a failure to record must not become a failure to act", () => {
  it("swallows a write error instead of propagating it to the caller", async () => {
    h.state.failEveryWrite = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Every call site is a login, a restore, a credential change. A throw here
    // turns an unwritable audit table into an instance nobody can sign in to.
    await expect(recordAuditEvent({ action: AUDIT.loginSucceeded })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("records nothing rather than half a row when there is no request scope", async () => {
    h.state.noRequest = true;
    await recordAuditEvent({ action: AUDIT.backupRestored, actorLabel: "owner" });
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0].ip).toBeNull();
    expect(h.rows[0].actorLabel).toBe("owner");
  });
});

describe("the IP recorded as evidence", () => {
  it("is the client's, not the last proxy in the chain", async () => {
    h.state.headers.set("x-forwarded-for", "203.0.113.7, 10.0.0.1, 172.18.0.4");
    await recordAuditEvent({ action: AUDIT.loginFailed });
    expect(h.rows[0].ip).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, and to null rather than an empty string", async () => {
    h.state.headers.set("x-real-ip", "198.51.100.9");
    await recordAuditEvent({ action: AUDIT.loginFailed });
    expect(h.rows[0].ip).toBe("198.51.100.9");

    h.rows.length = 0;
    h.state.headers = new Map([["x-forwarded-for", "  "]]);
    await recordAuditEvent({ action: AUDIT.loginFailed });
    expect(h.rows[0].ip).toBeNull();
  });

  it("prefers an explicitly passed IP, for callers holding the real request", async () => {
    h.state.headers.set("x-forwarded-for", "203.0.113.7");
    await recordAuditEvent({ action: AUDIT.loginFailed, ip: "192.0.2.5" });
    expect(h.rows[0].ip).toBe("192.0.2.5");
  });
});

describe("the action keys", () => {
  it("are stable dotted identifiers, never translated sentences", async () => {
    // They are grepped and compared across versions; a renamed key silently
    // orphans the history that used the old one.
    for (const action of Object.values(AUDIT)) {
      expect(action).toMatch(/^[a-z]+(?:_[a-z]+)*\.[a-z]+(?:_[a-z]+)*$/);
    }
  });

  it("are all distinct, so two different events cannot merge in the log", async () => {
    const values = Object.values(AUDIT);
    expect(new Set(values).size).toBe(values.length);
  });
});
