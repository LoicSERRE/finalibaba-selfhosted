"use client";

import { setDiscreet } from "@/components/layout/discretion";
import { DISCRETION_ATTRIBUTE } from "@/lib/domain/discretion";

/** The palette's non-navigation commands (v2.15), by id. */
export const PALETTE_ACTIONS = ["discretion", "theme-dark", "theme-light", "theme-auto", "locale-fr", "locale-en", "help"] as const;
export type PaletteAction = (typeof PALETTE_ACTIONS)[number];

/**
 * Run one. Theme and language reuse the same cookie routes as their
 * Settings controls, then refresh so the server renders the new choice.
 */
export async function runPaletteAction(action: string, refresh: () => void) {
  if (action === "discretion") {
    setDiscreet(!document.documentElement.hasAttribute(DISCRETION_ATTRIBUTE));
    return;
  }
  if (action.startsWith("theme-")) {
    await fetch(`/api/set-theme?theme=${action.slice("theme-".length)}`);
    refresh();
    return;
  }
  if (action.startsWith("locale-")) {
    await fetch(`/api/set-locale?locale=${action.slice("locale-".length)}`);
    refresh();
  }
}
