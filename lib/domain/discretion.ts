/**
 * Discretion mode (v2.13): every amount on every page blurred, for opening
 * the app in public or sharing a screen. A per-device preference, so a cookie
 * rather than a UserSettings column - the same reason THEME is one, and it
 * lets the root layout render <html data-discreet> on the very first paint
 * instead of flashing the figures until hydration.
 *
 * What gets blurred is decided in CSS (globals.css, "Discretion mode"): any
 * element carrying the `amount` class, plus the chart parts that print
 * figures. Pure logic only here; the toggle lives in
 * components/layout/discretion.tsx.
 */

export const DISCRETION_COOKIE = "DISCREET";

/** The <html> attribute globals.css keys off. */
export const DISCRETION_ATTRIBUTE = "data-discreet";

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

type TargetLike = { tagName?: string; isContentEditable?: boolean };

/**
 * Whether a keydown is the discretion shortcut: a bare "h" (or "H"), held
 * down only once, and never while the user is typing - an "h" in a label or
 * a search box must stay an "h". Modifier combinations are left alone so
 * browser and OS shortcuts keep working.
 */
export function isDiscretionShortcut(event: KeyEventLike): boolean {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key.toLowerCase() !== DISCRETION_SHORTCUT_KEY) return false;
  const target = event.target as TargetLike | null;
  if (!target) return true;
  if (target.isContentEditable) return false;
  const tag = target.tagName?.toUpperCase();
  return tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT";
}
