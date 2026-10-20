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
  it("marks every formatCurrency and formatMoney a page renders", () => {
    const files = globSync("{app,components}/**/*.tsx").filter((f) => !f.includes("generated"));
    const unmarked: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        // formatMoney (v2.18) prints an amount in an account's own currency.
        if (!/formatCurrency\(|formatMoney\(/.test(line) || /function format(Currency|Money)|=> format(Currency|Money)\(/.test(line)) return;
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

  // What a phone reads while shaken (accelerationIncludingGravity): gravity
  // on one axis plus the hand's swing, a sine along some direction. A real
  // shake is ~2-4 a second with swings of 12-30 m/s²; a few centimetres of
  // wobble stays under ~9. 60 samples a second.
  const HZ = 60;
  type Shake = { amplitude: number; perSecond: number; cycles: number; direction?: [number, number, number] };
  function shake({ amplitude, perSecond, cycles, direction = [1, 0, 0] }: Shake, startMs = 0) {
    const n = Math.round((cycles / perSecond) * HZ);
    return Array.from({ length: n }, (_, i) => {
      const t = i / HZ;
      const a = amplitude * Math.sin(2 * Math.PI * perSecond * t);
      // Gravity on z: a phone held flat-ish in the hand.
      return { motion: { x: a * direction[0], y: a * direction[1], z: 9.81 + a * direction[2] }, at: startMs + t * 1000 };
    });
  }
  type Detector = ReturnType<typeof createShakeDetector>;
  function play(detect: Detector, samples: ReadonlyArray<{ motion: Parameters<Detector>[0]; at: number }>) {
    return samples.map(({ motion, at }) => detect(motion, at));
  }
  const GOOD = { amplitude: 20, perSecond: 3 };

  it("fires once, on the third shake", () => {
    const fired = play(createShakeDetector(), shake({ ...GOOD, cycles: 3 }));
    expect(fired.filter(Boolean)).toHaveLength(1);
    // Never before two full shakes are over.
    expect(fired.indexOf(true)).toBeGreaterThanOrEqual(Math.round((2 / GOOD.perSecond) * HZ));
  });

  it("never on two", () => {
    expect(play(createShakeDetector(), shake({ ...GOOD, cycles: 2 })).some(Boolean)).toBe(false);
  });

  // v2.18.1 demanded a drop under 5 m/s² of hand motion between swings and a
  // reversal at each one, and fired on nothing on a real phone: a vigorous,
  // fast, irregular shake must still count.
  it("fires on a fast, strong shake, and on a fairly gentle one", () => {
    expect(play(createShakeDetector(), shake({ amplitude: 30, perSecond: 4.5, cycles: 3 })).some(Boolean)).toBe(true);
    expect(play(createShakeDetector(), shake({ amplitude: 13, perSecond: 2.5, cycles: 3 })).some(Boolean)).toBe(true);
  });

  it("counts an up-and-down shake as well as a sideways one", () => {
    expect(play(createShakeDetector(), shake({ ...GOOD, cycles: 3, direction: [0, 0, 1] })).some(Boolean)).toBe(true);
  });

  it("ignores a few centimetres of wobble, however long", () => {
    expect(play(createShakeDetector(), shake({ amplitude: 9, perSecond: 3, cycles: 10 })).some(Boolean)).toBe(false);
  });

  it("ignores a bump, walking, and swings too slow to be a shake", () => {
    // A phone set down hard: one sharp peak and its rebound.
    const bump = [0, 25, -12, 4, 0, 0].map((x, i) => ({ motion: { x, y: 0, z: 9.81 }, at: i * 16 }));
    expect(play(createShakeDetector(), bump).some(Boolean)).toBe(false);
    // Walking: the hand bobs a few m/s² twice a second.
    expect(play(createShakeDetector(), shake({ amplitude: 4, perSecond: 2, cycles: 20, direction: [0, 0, 1] })).some(Boolean)).toBe(false);
    // Strong swings far apart are not one gesture.
    expect(play(createShakeDetector(), shake({ amplitude: 20, perSecond: 0.6, cycles: 4 })).some(Boolean)).toBe(false);
  });

  // The same gesture toggles both ways (like Trade Republic): a second set of
  // three shakes, once the cooldown is over, fires again.
  it("fires again for the next three shakes, after the cooldown", () => {
    const detect = createShakeDetector();
    expect(play(detect, shake({ ...GOOD, cycles: 3 }, 0)).some(Boolean)).toBe(true);
    expect(play(detect, shake({ ...GOOD, cycles: 1 }, 1050)).some(Boolean)).toBe(false);
    expect(play(detect, shake({ ...GOOD, cycles: 3 }, 4000)).some(Boolean)).toBe(true);
  });

  it("ignores samples without readings", () => {
    const detect = createShakeDetector();
    expect(detect({ x: null, y: null, z: null }, 0)).toBe(false);
  });
});
