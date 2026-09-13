import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The properties here were pinned against the in-memory limiter this replaced
 * (`createRateLimiter` in lib/auth.ts, deleted in v2.10.6) and are carried
 * over deliberately rather than rewritten: they are what the limiter is FOR,
 * and the implementation changing is exactly when they are worth re-checking.
 *
 * The one genuinely new property is the reason for the change - the counter
 * now lives in a table, so it survives a restart. The old map did not, which
 * meant anything that could crash-loop the container also cleared the brake on
 * guessing a password, and `restart: unless-stopped` makes that cheap to
 * cause.
 *
 * An in-memory store stands in for the table: these assert the limiter's
 * logic, not Prisma's, and the failing-open behaviour below cannot be reached
 * at all with a real database.
 */

type Row = { key: string; count: number; resetAt: Date };

// vi.mock's factory is hoisted above every top-level statement, so the fake's
// state has to be hoisted with it or the factory runs before it exists.
const h = vi.hoisted(() => {
  const rows = new Map<string, { key: string; count: number; resetAt: Date }>();
  const state = { failEveryQuery: false };
  const guard = () => {
    if (state.failEveryQuery) throw new Error("database unreachable");
  };
  return {
    rows,
    state,
    findUnique: async ({ where }: { where: { key: string } }) => {
      guard();
      return rows.get(where.key) ?? null;
    },
    upsert: async ({ where, create }: { where: { key: string }; create: Row }) => {
      guard();
      rows.set(where.key, { ...create });
      return create;
    },
    update: async ({ where }: { where: { key: string } }) => {
      guard();
      const row = rows.get(where.key)!;
      row.count += 1;
      return row;
    },
    deleteMany: async ({ where }: { where: { key?: string; resetAt?: { lte: Date } } }) => {
      if (where.key) return { count: rows.delete(where.key) ? 1 : 0 };
      let count = 0;
      for (const [k, v] of rows) {
        if (v.resetAt <= where.resetAt!.lte) {
          rows.delete(k);
          count += 1;
        }
      }
      return { count };
    },
  };
});
const rows = h.rows;

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    rateLimit: {
      findUnique: h.findUnique,
      upsert: h.upsert,
      update: h.update,
      deleteMany: h.deleteMany,
    },
  },
}));

import {
  clearAttempts,
  consumeAttempt,
  sweepExpiredRateLimits,
  LOGIN_MAX_ATTEMPTS,
} from "@/lib/services/rate-limit";

beforeEach(() => {
  rows.clear();
  h.state.failEveryQuery = false;
});

describe("counting attempts", () => {
  it("allows up to the maximum for one key", async () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      expect(await consumeAttempt("1.2.3.4|alice", LOGIN_MAX_ATTEMPTS)).toBe(true);
    }
  });

  it("refuses the one after that", async () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) await consumeAttempt("1.2.3.4|alice", LOGIN_MAX_ATTEMPTS);
    expect(await consumeAttempt("1.2.3.4|alice", LOGIN_MAX_ATTEMPTS)).toBe(false);
  });

  it("tracks each key independently", async () => {
    // The exact bug the keying was changed for: a shared key lets one
    // attacker's failures lock out every other person behind the same NAT or
    // reverse proxy - which on a family instance is everyone.
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) await consumeAttempt("attacker|alice", LOGIN_MAX_ATTEMPTS);
    expect(await consumeAttempt("attacker|alice", LOGIN_MAX_ATTEMPTS)).toBe(false);
    expect(await consumeAttempt("owner|bob", LOGIN_MAX_ATTEMPTS)).toBe(true);
  });

  it("starts a fresh window once the old one has closed", async () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) await consumeAttempt("k", LOGIN_MAX_ATTEMPTS);
    expect(await consumeAttempt("k", LOGIN_MAX_ATTEMPTS)).toBe(false);

    rows.get("k")!.resetAt = new Date(Date.now() - 1000);
    expect(await consumeAttempt("k", LOGIN_MAX_ATTEMPTS)).toBe(true);
  });
});

describe("a success clears the count", () => {
  it("so a legitimate user who mistyped twice is not near a lockout an hour later", async () => {
    await consumeAttempt("k", LOGIN_MAX_ATTEMPTS);
    await consumeAttempt("k", LOGIN_MAX_ATTEMPTS);
    await clearAttempts("k");
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      expect(await consumeAttempt("k", LOGIN_MAX_ATTEMPTS)).toBe(true);
    }
  });
});

describe("what happens when the database is unreachable", () => {
  it("fails OPEN rather than locking everyone out", async () => {
    // Deliberate, and the reason is worth pinning: failing closed would turn a
    // database blip into a total lockout of every user, the admin who needs to
    // log in and fix it included. The path this guards still requires a
    // correct password, so failing open degrades to the protection that
    // existed before the limiter, not to none.
    h.state.failEveryQuery = true;
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS * 3; i++) {
      expect(await consumeAttempt("k", LOGIN_MAX_ATTEMPTS)).toBe(true);
    }
  });
});

describe("the sweep", () => {
  it("drops closed windows and leaves open ones alone", async () => {
    await consumeAttempt("open", LOGIN_MAX_ATTEMPTS);
    await consumeAttempt("closed", LOGIN_MAX_ATTEMPTS);
    rows.get("closed")!.resetAt = new Date(Date.now() - 1000);

    expect(await sweepExpiredRateLimits()).toBe(1);
    expect(rows.has("open")).toBe(true);
    expect(rows.has("closed")).toBe(false);
  });
});
