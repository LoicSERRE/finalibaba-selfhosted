"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  DISCRETION_ATTRIBUTE,
  DISCRETION_SHORTCUT_KEY,
  discretionCookie,
  isDiscretionShortcut,
} from "@/lib/domain/discretion";

// The <html> attribute is the single source of truth on the client: the root
// layout renders it from the DISCREET cookie, and toggling sets the attribute
// and the cookie together, so the next server render agrees with what is on
// screen. No router.refresh(): blurring is pure CSS, nothing needs refetching.

const CHANGE_EVENT = "finalibaba:discretionchange";

function subscribe(onChange: () => void) {
  globalThis.addEventListener(CHANGE_EVENT, onChange);
  return () => globalThis.removeEventListener(CHANGE_EVENT, onChange);
}

function readDiscreet(): boolean {
  return document.documentElement.hasAttribute(DISCRETION_ATTRIBUTE);
}

export function setDiscreet(on: boolean) {
  if (on) document.documentElement.setAttribute(DISCRETION_ATTRIBUTE, "");
  else document.documentElement.removeAttribute(DISCRETION_ATTRIBUTE);
  document.cookie = discretionCookie(on);
  globalThis.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Current state and a toggle; every mounted toggle stays in step. */
export function useDiscretion(serverValue: boolean) {
  const discreet = useSyncExternalStore(subscribe, readDiscreet, () => serverValue);
  const toggle = useCallback(() => setDiscreet(!readDiscreet()), []);
  return { discreet, toggle };
}

/** Global keyboard shortcut, mounted once in the root layout. */
export function DiscretionShortcut() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isDiscretionShortcut(event)) return;
      event.preventDefault();
      setDiscreet(!readDiscreet());
    }
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, []);
  return null;
}

// Per-field readonly rather than `Readonly<{...}>`: a top-level Readonly alias
// blinds lizard to the rest of the file (dev-docs/release-audit.md, item 2).
type ToggleProps = {
  /** The cookie's value at render time, for the server/hydration snapshot. */
  readonly initial: boolean;
  /** "row": icon + label (sidebar, settings); "icon": icon only (mobile header). */
  readonly variant?: "row" | "icon";
  readonly className?: string;
};

export function DiscretionToggle({ initial, variant = "row", className = "" }: ToggleProps) {
  const t = useTranslations("discretion");
  const { discreet, toggle } = useDiscretion(initial);
  const Icon = discreet ? EyeOff : Eye;
  const label = discreet ? t("show") : t("hide");
  const shortcut = DISCRETION_SHORTCUT_KEY.toUpperCase();

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={discreet}
        aria-label={label}
        title={`${label} (${shortcut})`}
        className={`inline-flex items-center justify-center w-11 h-11 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-elevated)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${className}`}
      >
        <Icon size={20} aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={discreet}
      title={`${label} (${shortcut})`}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-elevated)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${className}`}
    >
      <Icon size={16} aria-hidden="true" />
      <span className="flex-1 text-left">{label}</span>
      <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--muted)]">{shortcut}</kbd>
    </button>
  );
}
