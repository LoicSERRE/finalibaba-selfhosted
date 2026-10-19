"use client";

/**
 * Opening the command palette from anywhere (v2.15): the sidebar button, the
 * phone dashboard icon and the keyboard all go through this one event, so
 * there is a single palette and a single place that decides it is open.
 */
export const OPEN_PALETTE_EVENT = "finalibaba:openpalette";

export type PaletteMode = "search" | "help";

export function openPalette(mode: PaletteMode = "search") {
  globalThis.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT, { detail: mode }));
}
