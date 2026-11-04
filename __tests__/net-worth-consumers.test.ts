import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// dev-docs/companies.md: "a test lists these entry points and fails if a new
// net-worth consumer appears without the share". A person's company shares
// enter their figures in exactly two places - lib/services/net-worth.ts for
// computeDashboard, and the analytics page for computeAnalytics. A third
// caller that loads accounts and computes on its own would show that person
// without their SCI, and nothing else would notice.

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "generated" ? [] : sources(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

// Comments stripped: several routes say they "reuse computeDashboard()".
function code(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const start = src.indexOf("/*", i);
    if (start === -1) break;
    out += src.slice(i, start);
    const end = src.indexOf("*/", start + 2);
    i = end === -1 ? src.length : end + 2;
  }
  out += src.slice(i);
  return out
    .split("\n")
    .map((line) => {
      const at = line.indexOf("//");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

const files = [...sources("app"), ...sources("lib"), ...sources("components")].map((path) => ({
  path,
  src: code(readFileSync(path, "utf8")),
}));

describe("every net worth goes through the company-aware loaders", () => {
  it("finds the source tree at all", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("calls computeDashboard only from lib/services/net-worth.ts", () => {
    const callers = files
      .filter((f) => /\bcomputeDashboard\(/.test(f.src))
      .map((f) => f.path)
      .filter((p) => p !== "lib/domain/dashboard.ts");
    expect(callers).toEqual(["lib/services/net-worth.ts"]);
  });

  it("passes company shares to every computeAnalytics call", () => {
    const callers = files.filter((f) => /\bcomputeAnalytics\(\{/.test(f.src));
    expect(callers.map((f) => f.path)).toEqual(["app/analytics/page.tsx"]);
    for (const f of callers) expect(f.src).toMatch(/companyShares,?\s/);
  });

  it("says, at every computePortfolio call, whose shares belong in it", () => {
    // shareholderId is required by the type, so this guards against a
    // blanket `null` creeping into a person's portfolio: each null must be a
    // deliberate one, on a set that is not one person's.
    const nulls = files.flatMap((f) =>
      f.src
        .split("computePortfolio({")
        .slice(1)
        .filter((call) => call.slice(0, call.indexOf("}")).includes("shareholderId: null"))
        .map(() => f.path)
    );
    // The accounts list (a share is not an account) and a company's own
    // value (a company holds no companies here).
    expect(nulls).toEqual(["app/api/v1/accounts/route.ts", "lib/services/companies-read.ts"]);
  });
});
