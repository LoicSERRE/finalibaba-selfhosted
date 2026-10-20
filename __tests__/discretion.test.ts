import { describe, expect, it } from "vitest";
import { globSync, readFileSync } from "node:fs";
import {
  DISCRETION_COOKIE,
  DISCRETION_SHAKE_COOKIE,
  DISCRETION_TARGETS,
  SCRAMBLED_ATTRIBUTE,
  createShakeDetector,
  discretionCookie,
  isDiscreet,
  isDiscretionShortcut,
  scrambleText,
  shakeCookie,
  shakeListening,
  shakeShownOn,
  shakePreference,
} from "@/lib/domain/discretion";
import { formatCurrency, formatPercent } from "@/lib/utils/format";

/**
 * Discretion mode (v2.13) hides every amount - blurred, then scrambled once
 * the client takes over (v2.18). Its failure mode is silent by
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

describe("what gets hidden", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const rule = css.slice(css.indexOf("[data-discreet] .amount:not("));
  const selectors = rule.slice(0, rule.indexOf("{")).split(",").map((s) => s.trim());

  it("covers marked amounts and every chart part that prints a figure", () => {
    expect([...DISCRETION_TARGETS]).toEqual([
      ".amount",
      // Recharts 3 renders tick labels in their own layer, outside the axis
      // group - `.recharts-yAxis .tick` matched nothing at all.
      ".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value",
      ".recharts-tooltip-wrapper",
      ".recharts-label-list",
      ".recharts-pie-labels",
    ]);
  });

  // The blur is what hides a target the client has not scrambled yet - on
  // first paint, before hydration. It must cover exactly the same list.
  it("blurs every target until the client has scrambled it", () => {
    expect(selectors).toEqual(DISCRETION_TARGETS.map((t) => `[data-discreet] ${t}:not([${SCRAMBLED_ATTRIBUTE}])`));
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

describe("scrambling", () => {
  const SALT = "test-salt";
  const NOISE = /^[2-9A-HJ-NP-Z]{4,7}$/;

  it("replaces an amount's figure, keeping its sign and currency", () => {
    const amount = formatCurrency(-123456789); // "-1 234 567,89 €"
    const scrambled = scrambleText(amount, SALT);
    const [, figure] = /^-(.+)\u00A0€$/.exec(scrambled) ?? [];
    expect(figure).toMatch(NOISE);
    expect(scrambled).not.toMatch(/1|234|567|89/);
  });

  it("hides the order of magnitude: lengths do not follow the figure", () => {
    const lengths = new Set(
      [1, 99, 12345, 9876543210].map((cents) => /^(\S+)/.exec(scrambleText(formatCurrency(cents), SALT))![1].length)
    );
    for (const length of lengths) expect(length).toBeGreaterThanOrEqual(4);
    expect([...lengths].every((l) => l <= 7)).toBe(true);
  });

  it("leaves percentages, dates, times and years readable", () => {
    for (const text of [formatPercent(0.052), formatPercent(-0.1234, 2), "12 %", "Le 03/02/2026", "à 14:30", "mars 2026", "4 déc.", "12 oct.", "4 Dec", "Dec 4", "Solde au 4 déc. 2025"]) {
      expect(scrambleText(text, SALT)).toBe(text);
    }
  });

  it("scrambles only the figures in a sentence", () => {
    const sentence = `Vous avez dépensé ${formatCurrency(4200)} en mars 2026, soit ${formatPercent(0.12)} de plus`;
    const scrambled = scrambleText(sentence, SALT);
    expect(scrambled).not.toContain("42,00");
    expect(scrambled).toContain("Vous avez dépensé ");
    expect(scrambled).toContain(" en mars 2026, soit ");
    expect(scrambled).toContain(formatPercent(0.12));
  });

  it("keeps a day of the month but not an amount next to a month", () => {
    const scrambled = scrambleText(`4 déc. : ${formatCurrency(1200)}`, SALT);
    expect(scrambled.startsWith("4 déc. : ")).toBe(true);
    expect(scrambled).not.toContain("12,00");
    // Three digits is never a day.
    expect(scrambleText("120 mai", SALT)).not.toContain("120");
  });

  it("hides quantities and a year-shaped amount", () => {
    expect(scrambleText("12,5", SALT)).toMatch(NOISE);
    expect(scrambleText("2026 €", SALT)).not.toContain("2026");
  });

  it("is stable for a salt, so a re-render does not flicker, and differs across salts", () => {
    const amount = formatCurrency(123456);
    expect(scrambleText(amount, SALT)).toBe(scrambleText(amount, SALT));
    const others = new Set(["a", "b", "c", "d", "e"].map((salt) => scrambleText(amount, salt)));
    expect(others.size).toBeGreaterThan(1);
  });

  it("reads the % and the month from the neighbouring text", () => {
    expect(scrambleText("5.2", SALT, { before: "(+", after: "%)" })).toBe("5.2");
    expect(scrambleText("4", SALT, { after: " déc." })).toBe("4");
    expect(scrambleText("5.2", SALT, { after: " €" })).toMatch(NOISE);
  });

  it("leaves text without a figure alone", () => {
    expect(scrambleText("—", SALT)).toBe("—");
    expect(scrambleText("", SALT)).toBe("");
  });
});

describe("shake to hide", () => {
  it("listens by default, and stops only when turned off", () => {
    expect(shakeListening("unset")).toBe(true);
    expect(shakeListening("on")).toBe(true);
    expect(shakeListening("off")).toBe(false);
  });

  // Recent Chrome has requestPermission too and sends motion without it, so
  // "a prompt API exists" alone must not make the default look off there.
  it("shows the default as on only where it works", () => {
    expect(shakeShownOn("unset", false, false)).toBe(true);
    expect(shakeShownOn("unset", true, true)).toBe(true);
    expect(shakeShownOn("unset", true, false)).toBe(false);
    expect(shakeShownOn("on", true, false)).toBe(true);
    expect(shakeShownOn("off", false, true)).toBe(false);
  });

  it("reads back exactly the choices it writes", () => {
    expect(shakeCookie(true)).toBe(`${DISCRETION_SHAKE_COOKIE}=1; path=/; max-age=31536000; samesite=lax`);
    expect(shakeCookie(false)).toBe(`${DISCRETION_SHAKE_COOKIE}=0; path=/; max-age=31536000; samesite=lax`);
    expect(shakePreference("1")).toBe("on");
    expect(shakePreference("0")).toBe("off");
    for (const value of [undefined, "", "true", "2"]) expect(shakePreference(value)).toBe("unset");
  });

  // A phone at rest reads 9.8 m/s² (gravity); each swing of a shake peaks
  // well past 15. `trace` plays one sample per character, 60 a second like a
  // phone: "s" a swing, "r" at rest.
  const REST = { x: 0, y: 0, z: 9.8 };
  const SWING = { x: 18, y: 6, z: 9.8 };
  const STEP_MS = 16;
  function trace(detect: ReturnType<typeof createShakeDetector>, pattern: string, startMs = 0) {
    return [...pattern].map((c, i) => detect(c === "s" ? SWING : REST, startMs + i * STEP_MS));
  }
  // One swing every ~200ms: three of them is the gesture.
  const swing = "ss" + "r".repeat(10);
  const THREE_SHAKES = swing.repeat(3);

  it("fires once on three quick shakes", () => {
    const fired = trace(createShakeDetector(), "rr" + THREE_SHAKES);
    expect(fired.filter(Boolean)).toHaveLength(1);
  });

  it("does not fire on two", () => {
    expect(trace(createShakeDetector(), "rr" + swing.repeat(2) + "r".repeat(80)).some(Boolean)).toBe(false);
  });

  // The same gesture toggles both ways (v2.18, like Trade Republic): a second
  // set of three, once the cooldown is over, fires again.
  it("fires again for the next three, after the cooldown", () => {
    const detect = createShakeDetector();
    expect(trace(detect, THREE_SHAKES, 0).some(Boolean)).toBe(true);
    expect(trace(detect, THREE_SHAKES, 700).some(Boolean)).toBe(false);
    expect(trace(detect, THREE_SHAKES, 3000).some(Boolean)).toBe(true);
  });

  it("ignores a bump and its rebound, walking, and shakes too far apart", () => {
    // A phone set down hard: one peak, a rebound 30ms later.
    expect(trace(createShakeDetector(), "rrsrsrrrrrrrrrrrrrrrrrrr").some(Boolean)).toBe(false);
    // Walking: magnitude wobbles around gravity, never near the threshold.
    const walk = createShakeDetector();
    const steps = Array.from({ length: 300 }, (_, i) => walk({ x: 1, y: 2, z: 9.8 + 3 * Math.sin(i / 5) }, i * STEP_MS));
    expect(steps.some(Boolean)).toBe(false);
    // Three swings over two seconds is not a shake.
    const slow = "ss" + "r".repeat(45);
    expect(trace(createShakeDetector(), slow.repeat(3)).some(Boolean)).toBe(false);
  });

  it("counts a swing held across several samples once", () => {
    // A slow, wide swing stays past the threshold for ~200ms - longer than
    // minGapMs - and still counts once.
    const longSwing = "s".repeat(12) + "r".repeat(8);
    expect(trace(createShakeDetector(), longSwing.repeat(2) + "r".repeat(80)).some(Boolean)).toBe(false);
    expect(trace(createShakeDetector(), longSwing.repeat(3)).some(Boolean)).toBe(true);
  });

  it("ignores samples without readings", () => {
    const detect = createShakeDetector();
    expect(detect({ x: null, y: null, z: null }, 0)).toBe(false);
  });
});
