import { describe, expect, it } from "vitest";
import { globSync, readFileSync } from "node:fs";
import {
  DISCRETION_COOKIE,
  discretionCookie,
  isDiscreet,
  isDiscretionShortcut,
} from "@/lib/domain/discretion";

/**
 * Discretion mode (v2.13) blurs every amount. Its failure mode is silent by
 * construction - a figure that was never marked simply stays readable, which
 * looks exactly like a page that works - so besides the pure logic this pins
 * the two things a new screen could quietly break: the CSS selector list, and
 * the rule that every rendered formatCurrency sits inside an `amount` element.
 *
 * The exhaustive check is a browser scan of every page with the mode on (no
 * visible € text without a real blur, none blurred with it off); it found
 * 1150 leaks before the markers and 0 after. This static check is its cheap,
 * always-on stand-in.
 */

describe("the cookie", () => {
  it("is on only for the exact value it writes", () => {
    expect(isDiscreet("1")).toBe(true);
    for (const value of [undefined, "", "0", "true", "on"]) expect(isDiscreet(value)).toBe(false);
  });

  it("persists a choice for a year and clears it on the way out", () => {
    expect(discretionCookie(true)).toBe(`${DISCRETION_COOKIE}=1; path=/; max-age=31536000; samesite=lax`);
    expect(discretionCookie(false)).toContain("max-age=0");
  });
});

describe("the H shortcut", () => {
  const key = (over: Partial<Parameters<typeof isDiscretionShortcut>[0]> = {}) => ({
    key: "h", ctrlKey: false, metaKey: false, altKey: false, repeat: false,
    target: { tagName: "BODY", isContentEditable: false }, ...over,
  });

  it("toggles on a bare h or H", () => {
    expect(isDiscretionShortcut(key())).toBe(true);
    expect(isDiscretionShortcut(key({ key: "H" }))).toBe(true);
    expect(isDiscretionShortcut(key({ target: null }))).toBe(true);
  });

  it("never fires while the user is typing", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "input"]) {
      expect(isDiscretionShortcut(key({ target: { tagName } }))).toBe(false);
    }
    expect(isDiscretionShortcut(key({ target: { tagName: "DIV", isContentEditable: true } }))).toBe(false);
  });

  it("leaves modifier combinations and key repeat to the browser", () => {
    expect(isDiscretionShortcut(key({ ctrlKey: true }))).toBe(false);
    expect(isDiscretionShortcut(key({ metaKey: true }))).toBe(false);
    expect(isDiscretionShortcut(key({ altKey: true }))).toBe(false);
    expect(isDiscretionShortcut(key({ repeat: true }))).toBe(false);
    expect(isDiscretionShortcut(key({ key: "j" }))).toBe(false);
  });
});

describe("what gets blurred", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const rule = css.slice(css.indexOf("[data-discreet] .amount,"));
  const selectors = rule.slice(0, rule.indexOf("{")).split(",").map((s) => s.trim());

  it("covers marked amounts and every chart part that prints a figure", () => {
    expect(selectors).toEqual([
      "[data-discreet] .amount",
      // Recharts 3 renders tick labels in their own layer, outside the axis
      // group - `.recharts-yAxis .tick` matched nothing at all.
      "[data-discreet] .recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value",
      "[data-discreet] .recharts-tooltip-wrapper",
      "[data-discreet] .recharts-label-list",
      "[data-discreet] .recharts-pie-labels",
    ]);
    expect(rule.slice(rule.indexOf("{"), rule.indexOf("}"))).toMatch(/filter:\s*blur\(0\.4em\)/);
  });

  // Same heuristic the markers were placed with: the nearest className at or
  // above the call must carry `amount`. Chart formatters are exempt - their
  // output lands in the axis/tooltip layers the selectors above cover.
  it("marks every formatCurrency a page renders", () => {
    const files = globSync("{app,components}/**/*.tsx").filter((f) => !f.includes("generated"));
    const unmarked: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!line.includes("formatCurrency(") || /function formatCurrency|=> formatCurrency\(/.test(line)) return;
        const before = lines.slice(Math.max(0, i - 4), i + 1).join("\n");
        if (/formatter|aria-label=|title=|placeholder=/.test(before)) return;
        const context = lines.slice(Math.max(0, i - 12), i + 1).join("\n");
        // The marker can sit on the className line, open a template literal, or
        // start both branches of a ternary spread over several lines.
        if (!/className=[^\n]*\bamount\b|`amount |"amount /.test(context)) unmarked.push(`${file}:${i + 1}`);
      });
    }
    expect(unmarked).toEqual([]);
    expect(files.length).toBeGreaterThan(50);
  });
});
