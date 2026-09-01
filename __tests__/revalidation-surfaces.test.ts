import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  accountSurfaces,
  categorySurfaces,
  holdingSurfaces,
  incomeSurfaces,
  saleSurfaces,
  transactionSurfaces,
} from "@/lib/domain/revalidation-surfaces";

/**
 * A mutating Server Action that revalidates nothing leaves the page you are
 * looking at showing the old value, with nothing failing anywhere to say so.
 * Measured against a production build, not assumed - see the module comment on
 * lib/domain/revalidation-surfaces.ts for the three experiments, including the
 * one that disproved the tidier theory that the *specific* path mattered.
 *
 * So the load-bearing assertion in this file is the last block: every action
 * that writes must revalidate, or refresh from its caller. The rest keeps the
 * route lists honest.
 */

const ACCOUNT_ID = "acc-1";
const CATEGORY_ID = "cat-1";

/** Every real page route, read off the filesystem rather than hardcoded. */
function realRoutes(dir = "app", prefix = ""): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "page.tsx") {
      routes.push(prefix || "/");
      continue;
    }
    if (!statSync(full).isDirectory()) continue;
    // Route groups and private folders do not appear in the URL.
    if (entry.startsWith("(") || entry.startsWith("_")) {
      routes.push(...realRoutes(full, prefix));
      continue;
    }
    routes.push(...realRoutes(full, `${prefix}/${entry}`));
  }
  return routes;
}

/** "/accounts/acc-1" matches the "/accounts/[id]" route. */
function isRealRoute(path: string, routes: string[]): boolean {
  const parts = path.split("/");
  return routes.some((route) => {
    const routeParts = route.split("/");
    if (routeParts.length !== parts.length) return false;
    return routeParts.every((seg, i) => seg.startsWith("[") || seg === parts[i]);
  });
}

const ALL_SURFACES = {
  account: accountSurfaces(ACCOUNT_ID),
  holding: holdingSurfaces(ACCOUNT_ID),
  transaction: transactionSurfaces(ACCOUNT_ID, [CATEGORY_ID]),
  category: categorySurfaces(CATEGORY_ID),
  income: incomeSurfaces(ACCOUNT_ID),
  sale: saleSurfaces(ACCOUNT_ID),
};

describe("every revalidated path is a real route", () => {
  const routes = realRoutes();

  it("finds the app's routes at all, so the assertions below mean something", () => {
    // Without this the loop underneath passes vacuously if the walk breaks.
    expect(routes).toContain("/");
    expect(routes).toContain("/transactions");
    expect(routes).toContain("/accounts/[id]");
  });

  for (const [name, paths] of Object.entries(ALL_SURFACES)) {
    it(`${name} surfaces all exist`, () => {
      const missing = paths.filter((path) => !isRealRoute(path, routes));
      expect(missing).toEqual([]);
    });
  }
});

describe("no surface list is empty or duplicated", () => {
  for (const [name, paths] of Object.entries(ALL_SURFACES)) {
    it(name, () => {
      // Empty is the one genuinely broken state: it is the "revalidates
      // nothing" case that leaves the screen stale.
      expect(paths.length).toBeGreaterThan(0);
      expect(paths).toEqual([...new Set(paths)]);
    });
  }
});

describe("account-scoped paths", () => {
  it("are included when an account is known", () => {
    expect(transactionSurfaces(ACCOUNT_ID)).toContain(`/accounts/${ACCOUNT_ID}`);
  });

  it("are omitted when it is not, rather than revalidating '/accounts/null'", () => {
    expect(transactionSurfaces(null).some((p) => p.startsWith("/accounts/"))).toBe(false);
    expect(transactionSurfaces().some((p) => p.startsWith("/accounts/"))).toBe(false);
  });

  it("include a category drill-down per affected category", () => {
    expect(transactionSurfaces(ACCOUNT_ID, ["cat-a", null, "cat-b"])).toEqual(
      expect.arrayContaining(["/budgets/cat-a", "/budgets/cat-b"]),
    );
  });

  it("skip a null category instead of building '/budgets/null'", () => {
    // Uncategorising a transaction passes null for the new category, which is
    // meaningful and must not become a path.
    expect(transactionSurfaces(ACCOUNT_ID, [null])).not.toContain("/budgets/null");
  });
});

/**
 * The check that reflects the measured rule.
 *
 * Every exported Server Action that writes to the database must revalidate
 * something - directly, through a local helper, or through one of the shared
 * helpers above. The allowlist below is for the ones that legitimately do not,
 * each with the reason it does not need to; anything else is a screen that
 * silently stops updating.
 */
const NO_REVALIDATION_NEEDED: Record<string, string> = {
  // Internal recompute called server-to-server by the snapshot cron, which has
  // no page to refresh. Its user-facing callers revalidate themselves.
  refreshAccountBalance: "internal helper, callers revalidate",
  // Write a transient challenge and return it to a caller that acts on the
  // return value; the panel around them is unchanged until the ceremony ends,
  // and the verify step that ends it does revalidate.
  startAppLockRegistration: "transient challenge, verify step revalidates",
  startAppLockAuthentication: "transient challenge, unlock is client-side",
  verifyAppLockAuthentication: "unlocks the overlay client-side, nothing rendered changes",
  startTotpSetup: "returns the QR payload the dialog renders from",
  // Reads first, and only writes VAPID keys the first time round; the
  // subscribe action that follows it revalidates.
  getPushStatus: "read path, generates keys lazily",
  // Ends by redirecting to the login page, so there is nothing to refresh.
  acceptInvitation: "redirects to /login",
  // Its only caller sends the browser straight to the bank's OAuth consent
  // page with window.location, so this page is gone before a refresh lands.
  setGocardlessInstitutionId: "caller navigates off-site immediately",
};

/** Any of the shared helpers, or revalidatePath/revalidateTag directly. */
const REVALIDATES = /revalidate(?:Path|Tag|Account|Holding|Transactions|Category|Income|Sale)\(/;
const WRITES = /prisma\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)|\$transaction\(|\$executeRaw/;

describe("every mutating action revalidates", () => {
  const actionFiles = readdirSync("lib/actions").filter((f) => f.endsWith(".ts"));

  it("reads the action files at all", () => {
    expect(actionFiles.length).toBeGreaterThan(20);
  });

  const offenders: string[] = [];
  for (const file of actionFiles) {
    const src = readFileSync(join("lib/actions", file), "utf8");
    if (!src.startsWith('"use server"')) continue;

    // Local helpers in this file that revalidate, so an action calling one of
    // them counts as covered. Split rather than matched with a greedy body
    // pattern, which is the shape sonarjs/super-linear-regex rejects.
    const helpers = new Set<string>();
    const declarations = src.split(/^(?:export )?(?:async )?function (\w+)/m);
    for (let i = 1; i < declarations.length; i += 2) {
      if (REVALIDATES.test(declarations[i + 1].split(/^(?:export )?(?:async )?function /m)[0])) {
        helpers.add(declarations[i]);
      }
    }

    const parts = src.split(/^export async function (\w+)/m);
    for (let i = 1; i < parts.length; i += 2) {
      const name = parts[i];
      const body = parts[i + 1].split(/^(?:async )?function /m)[0];
      if (!WRITES.test(body)) continue;
      const revalidates =
        REVALIDATES.test(body) || [...helpers].some((h) => body.includes(`${h}(`));
      if (!revalidates && !NO_REVALIDATION_NEEDED[name]) offenders.push(`${file}: ${name}`);
    }
  }

  it("no mutating action skips it without a stated reason", () => {
    expect(offenders).toEqual([]);
  });
});
