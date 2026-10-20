import { isBareKey } from "@/lib/domain/shortcuts";

/**
 * Discretion mode (v2.13, scrambled in v2.18): every amount on every page
 * replaced by random digits and letters, for opening the app in public or
 * sharing a screen. Percentages stay readable - how a portfolio is doing is
 * fine to show, how much is in it is not. A per-device preference, so a
 * cookie rather than a UserSettings column - the same reason THEME is one,
 * and it lets the root layout render <html data-discreet> on the very first
 * paint instead of flashing the figures until hydration.
 *
 * Which elements are targeted is decided by markers (`DISCRETION_TARGETS`):
 * any element carrying the `amount` class, plus the chart parts that print
 * figures. Until the client has scrambled a target, globals.css blurs it, so
 * nothing is readable before hydration either. Pure logic only here; the DOM
 * side lives in components/layout/discretion-scramble.ts.
 */

export const DISCRETION_COOKIE = "DISCREET";

/** The <html> attribute globals.css keys off. */
export const DISCRETION_ATTRIBUTE = "data-discreet";

/**
 * Set on a target once its figures have been replaced. globals.css blurs
 * every target without it, so a target the client has not reached yet - not
 * hydrated, a form field - is still unreadable.
 */
export const SCRAMBLED_ATTRIBUTE = "data-scrambled";

/**
 * Everything that prints an amount. Recharts 3 renders tick labels in their
 * own z-index layer (`.recharts-yAxis-tick-labels`), outside the axis group,
 * so an axis's own className cannot reach them. globals.css carries the same
 * list (pinned by __tests__/discretion.test.ts).
 */
export const DISCRETION_TARGETS = [
  ".amount",
  ".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value",
  ".recharts-tooltip-wrapper",
  ".recharts-label-list",
  ".recharts-pie-labels",
] as const;

/** Whether a DISCREET cookie value means "on". Anything unexpected is "off". */
export function isDiscreet(cookieValue: string | undefined): boolean {
  return cookieValue === "1";
}

/** The document.cookie assignment that persists a choice for a year. */
export function discretionCookie(on: boolean): string {
  return on
    ? `${DISCRETION_COOKIE}=1; path=/; max-age=31536000; samesite=lax`
    : `${DISCRETION_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

/** The keyboard shortcut, shown next to the toggle. */
export const DISCRETION_SHORTCUT_KEY = "h";

type KeyEventLike = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
  target: unknown;
};

/**
 * Whether a keydown is the discretion shortcut: a bare "h" (or "H"), held
 * down only once, and never while the user is typing - an "h" in a label or
 * a search box must stay an "h". Modifier combinations are left alone so
 * browser and OS shortcuts keep working. The typing rule is shared with the
 * other shortcuts (lib/domain/shortcuts.ts).
 */
export function isDiscretionShortcut(event: KeyEventLike): boolean {
  return isBareKey(event) && event.key.toLowerCase() === DISCRETION_SHORTCUT_KEY;
}

// ── Scrambling ──────────────────────────────────────────────────────────

// No 0/O or 1/I lookalikes: the point is to read as noise, not as a figure.
const SCRAMBLE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

// A run of digits with the separators formatCurrency emits (U+202F
// grouping, comma decimals), plus the slash and colon of a date or a time so
// those come out as one run, kept whole. It starts and ends on a digit, so a
// trailing comma in a sentence is never swallowed.
const NUMBER_RUN = /\d(?:[\d\u00A0\u202F.,'/:]*\d)?/g;
const DATE_OR_TIME = /[/:]/;
const PERCENT_AFTER = /^[\s\u00A0\u202F]*[%\u2030]/;
const CURRENCY_AFTER = /^[\s\u00A0\u202F]*[€$£¥₿]/;
const YEAR = /^(?:19|20)\d{2}$/;
const DAY = /^\d{1,2}$/;
const WORD_AFTER = /^\s+(\p{L}+)/u;
// The first three letters of every short month name a chart prints, in
// French and English ("4 déc.", "4 Dec", "Dec 4"): a day of the month says
// nothing about money, and scrambling it makes a tooltip's date unreadable.
const MONTHS = new Set(["jan", "fév", "feb", "mar", "avr", "apr", "mai", "may", "jui", "jun", "jul", "aoû", "aug", "sep", "oct", "nov", "déc", "dec"]);

function isMonth(word: string | undefined): boolean {
  return word !== undefined && MONTHS.has(word.slice(0, 3).toLowerCase());
}

function isDayOfMonth(day: string, before: string, after: string): boolean {
  if (!DAY.test(day)) return false;
  const wordBefore = before.trimEnd().split(/\s/).at(-1)?.replace(/\.$/, "");
  return isMonth(WORD_AFTER.exec(after)?.[1]) || isMonth(wordBefore);
}

/** FNV-1a: a stable 32-bit seed per (salt, figure). */
function seedOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.codePointAt(i) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: a tiny seeded generator, good enough to look like noise. */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseFor(figure: string, salt: string): string {
  const next = generator(seedOf(`${salt}|${figure}`));
  // 4 to 7 characters whatever the figure: its length would otherwise give
  // away its order of magnitude.
  const length = 4 + Math.floor(next() * 4);
  let noise = "";
  for (let i = 0; i < length; i++) noise += SCRAMBLE_ALPHABET[Math.floor(next() * SCRAMBLE_ALPHABET.length)];
  return noise;
}

/**
 * `text` with every figure replaced by 4-7 random digits and letters, except
 * percentages, dates (numeric or "4 déc."), times and bare years, which say
 * nothing about how much money there is. The sign and the currency symbol
 * are kept so an amount still reads as one.
 *
 * Deterministic for a given salt: a figure React re-renders unchanged (a
 * chart tooltip, on every mouse move) keeps the same noise instead of
 * flickering, while a fresh salt per page load means the noise cannot be
 * learned and reversed. Equal figures do look equal within a page.
 *
 * `context` is the text around `text` when it is one piece of a longer
 * line: JSX like `({sign}{value}%)` renders three text nodes, and the `%`
 * that makes `value` a percentage lives in the next one.
 */
export function scrambleText(text: string, salt: string, context: { before?: string; after?: string } = {}): string {
  return text.replace(NUMBER_RUN, (match: string, offset: number) => {
    if (DATE_OR_TIME.test(match)) return match;
    const after = text.slice(offset + match.length) + (context.after ?? "");
    const before = (context.before ?? "") + text.slice(0, offset);
    if (PERCENT_AFTER.test(after)) return match;
    if (YEAR.test(match) && !CURRENCY_AFTER.test(after)) return match;
    if (isDayOfMonth(match, before, after)) return match;
    return noiseFor(match, salt);
  });
}

// ── Shake to hide and show (v2.18) ──────────────────────────────────────

export const DISCRETION_SHAKE_COOKIE = "DISCREET_SHAKE";

/** "unset" until the user has chosen on this device. */
export type ShakePreference = "on" | "off" | "unset";

export function shakePreference(cookieValue: string | undefined): ShakePreference {
  if (cookieValue === "1") return "on";
  if (cookieValue === "0") return "off";
  return "unset";
}

/** Always an explicit choice, kept for a year like the discretion cookie. */
export function shakeCookie(on: boolean): string {
  return `${DISCRETION_SHAKE_COOKIE}=${on ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * On by default: the gesture is the whole feature, and asking first would
 * hide it. Listening costs nothing where the sensor stays silent - iOS sends
 * no motion until its prompt, which has to follow a tap, has been accepted,
 * so there it only starts once the user turns it on in Settings, never with
 * a prompt out of nowhere. (Whether a prompt is needed cannot be read off
 * the API: recent Chrome has `DeviceMotionEvent.requestPermission` too, and
 * sends motion without it.)
 */
export function shakeListening(preference: ShakePreference): boolean {
  return preference !== "off";
}

/**
 * What the Settings checkbox shows. "Unset" only reads as on where it
 * actually works: no prompt needed, or motion already arriving.
 */
export function shakeShownOn(preference: ShakePreference, needsPermission: boolean, motionSeen: boolean): boolean {
  if (preference !== "unset") return preference === "on";
  return !needsPermission || motionSeen;
}

type Motion = { x: number | null; y: number | null; z: number | null };

/** Standard gravity: what a phone at rest reads, whatever its orientation. */
const GRAVITY = 9.81;

type ShakeOptions = {
  /** How far the reading must swing from gravity, either way, to be a swing (m/s²). */
  threshold?: number;
  /** ...and come back within this of it before the next swing counts: one swing, one peak. */
  release?: number;
  /**
   * Swings that make the gesture. A shake - out and back - is two, so five
   * fire on the third shake and never on the second (four).
   */
  swings?: number;
  /** All of them within this window. */
  windowMs?: number;
  /** Swings closer than this are one: a single bump rebounds within a few samples. */
  minGapMs?: number;
  /** Quiet period after the gesture, so one gesture toggles once. */
  cooldownMs?: number;
};

/**
 * Three quick shakes of the phone toggle discretion, the gesture Trade
 * Republic uses. Fed the raw `accelerationIncludingGravity` (~60 samples a
 * second), it counts swings: the reading's magnitude moving more than
 * `threshold` away from gravity - above it at one end of a sideways swing,
 * above or below it for an up-and-down one - counted once until it comes
 * back within `release` of gravity. Five within 1.5s fire.
 *
 * Calibrated on the user's phone, in two directions: v2.18.0 (this
 * measure, 15 m/s² of magnitude, three swings) worked and felt right but
 * fired on the second shake as often as the third, three swings being a
 * shake and a half; v2.18.1 removed gravity and demanded each swing reverse
 * the previous one, which in simulation was precise and on a real phone
 * never fired at all, the hand's motion between swings never dropping
 * under its release. This keeps v2.18.0's measure and threshold and only
 * asks for five swings.
 */
export function createShakeDetector({
  threshold = 6,
  release = 3,
  swings = 5,
  windowMs = 1500,
  minGapMs = 80,
  cooldownMs = 1200,
}: ShakeOptions = {}): (motion: Motion, timestampMs: number) => boolean {
  let above = false;
  let peaks: number[] = [];
  let quietUntil = 0;

  return (motion, now) => {
    if (motion.x === null || motion.y === null || motion.z === null) return false;
    const deviation = Math.abs(Math.hypot(motion.x, motion.y, motion.z) - GRAVITY);
    if (above) {
      if (deviation < release) above = false;
      return false;
    }
    if (deviation <= threshold) return false;
    above = true;
    if (now < quietUntil) return false;

    const latest = peaks.at(-1);
    if (latest !== undefined && now - latest < minGapMs) return false;
    peaks = [...peaks.filter((at) => now - at < windowMs), now];
    if (peaks.length < swings) return false;
    peaks = [];
    quietUntil = now + cooldownMs;
    return true;
  };
}
