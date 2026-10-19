/**
 * Keyboard shortcuts (v2.15): what counts as "the user is typing", and the
 * two-key "g then letter" navigation. Pure - the listeners live in
 * components/layout/command-palette.tsx and discretion.tsx.
 */

type TargetLike = { tagName?: string; isContentEditable?: boolean } | null | undefined;

/** True while focus is in a field: a shortcut letter there must stay a letter. */
export function isTypingTarget(target: unknown): boolean {
  const t = target as TargetLike;
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

type KeyLike = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat?: boolean; target: unknown };

/** A bare key: no Ctrl/Cmd/Alt, not held down, not typed into a field. */
export function isBareKey(event: KeyLike): boolean {
  return !event.ctrlKey && !event.metaKey && !event.altKey && !event.repeat && !isTypingTarget(event.target);
}

/** Ctrl+K, or Cmd+K on a Mac - typed into a field too, like every app's palette. */
export function isPaletteShortcut(event: KeyLike): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k";
}

/** "g" then one of these, within GO_WINDOW_MS. */
export const GO_SHORTCUTS: Readonly<Record<string, string>> = {
  d: "/",
  c: "/accounts",
  t: "/transactions",
  b: "/budgets",
  r: "/recurring",
  i: "/income",
  a: "/analytics",
  f: "/tax-report",
  p: "/settings",
};

export const GO_WINDOW_MS = 1500;

/**
 * Where a key goes given the previous one: the href when it completes a
 * "g x" sequence in time, otherwise null. `previous` is the last bare key
 * pressed and when.
 */
export function goTarget(previous: { key: string; at: number } | null, key: string, now: number): string | null {
  if (!previous || previous.key !== "g" || now - previous.at > GO_WINDOW_MS) return null;
  return GO_SHORTCUTS[key.toLowerCase()] ?? null;
}
