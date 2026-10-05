"use client";

import { useEffect, useRef } from "react";

/**
 * Centres the active Settings tab in the phone tab row.
 *
 * Below md the tab list scrolls sideways and a fresh page load always starts
 * it at the left, so opening Notifications or Display put the active tab off
 * screen with nothing saying where you were (v2.12 visual audit). Sets the
 * list's own scrollLeft rather than calling scrollIntoView, which can scroll
 * the whole page too. A no-op from md up, where the list does not scroll.
 */
export function ActiveTabIntoView({ children }: Readonly<{ children: React.ReactNode }>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = ref.current?.querySelector("ul");
    const active = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !active || list.scrollWidth <= list.clientWidth) return;
    const item = active.parentElement ?? active;
    list.scrollLeft = item.offsetLeft - (list.clientWidth - item.clientWidth) / 2;
  });
  return <div ref={ref}>{children}</div>;
}
