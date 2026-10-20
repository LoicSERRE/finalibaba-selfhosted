"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  DOUBLE_TAP_ZOOM,
  clampView,
  fittedView,
  isZoomed,
  panBy,
  viewportFor,
  zoomAt,
  type Size,
  type View,
} from "@/lib/domain/pan-zoom";

/**
 * The gestures behind PanZoom (v2.18.1), on Pointer Events: two fingers
 * pinch, one finger pans once zoomed in (and scrolls the page while fitted,
 * through `touch-action: pan-y`), a double tap zooms in or back out. The
 * geometry is lib/domain/pan-zoom.ts.
 */

type Point = { x: number; y: number };

const TAP_SLOP_PX = 10;
const DOUBLE_TAP_MS = 300;
const BUTTON_ZOOM = 1.6;

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function pointIn(element: HTMLElement, event: { clientX: number; clientY: number }): Point {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

type Gesture = {
  pointers: Map<number, Point>;
  start: Point | null;
  moved: boolean;
  lastTap: { at: number; point: Point } | null;
};

/** The view after the pointers moved from `before` to `after`. */
function viewAfterMove(view: View, before: Point[], after: Point[], content: Size, viewport: Size): View {
  if (after.length >= 2 && before.length >= 2) {
    const factor = distance(after[0], after[1]) / Math.max(1, distance(before[0], before[1]));
    const from = midpoint(before[0], before[1]);
    const to = midpoint(after[0], after[1]);
    const zoomed = zoomAt(view, factor, to, content, viewport);
    return panBy(zoomed, to.x - from.x, to.y - from.y, content, viewport);
  }
  if (after.length === 1 && before.length === 1 && isZoomed(view, content, viewport.width)) {
    return panBy(view, after[0].x - before[0].x, after[0].y - before[0].y, content, viewport);
  }
  return view;
}

/**
 * `measureRef` is always rendered and measures the width available; `ref` is
 * the gesture area, which only exists once the content does not fit. Both are
 * the caller's, so what this returns carries no ref (React's compiler treats
 * every property of an object holding one as a ref read).
 */
export function usePanZoom(
  content: Size,
  measureRef: RefObject<HTMLDivElement | null>,
  ref: RefObject<HTMLDivElement | null>,
) {
  const [width, setWidth] = useState<number | null>(null);
  // The user's view, tied to the width it was made at: a rotation or a
  // resize starts again from the fitted view.
  const [user, setUser] = useState<{ width: number; view: View } | null>(null);
  const gesture = useRef<Gesture>({ pointers: new Map(), start: null, moved: false, lastTap: null });

  useEffect(() => {
    const element = measureRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [measureRef]);

  const active = width !== null && width < content.width;
  const viewport = active ? viewportFor(content, width) : null;
  const view =
    active && viewport
      ? user?.width === width
        ? clampView(user.view, content, viewport)
        : fittedView(content, width)
      : null;

  // Always from the latest view, never the one this render closed over: two
  // fingers send one pointermove each between renders, and with a plain
  // setState the second overwrote the first - a 3.7x pinch zoomed 1.9x.
  function update(next: (current: View, viewport: Size) => View) {
    if (width === null || !active) return;
    const vp = viewportFor(content, width);
    setUser((previous) => {
      const current = previous?.width === width ? clampView(previous.view, content, vp) : fittedView(content, width);
      return { width, view: next(current, vp) };
    });
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!ref.current) return;
    const point = pointIn(ref.current, event);
    gesture.current.pointers.set(event.pointerId, point);
    if (gesture.current.pointers.size === 1) {
      gesture.current.start = point;
      gesture.current.moved = false;
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!ref.current || !view || !viewport || !g.pointers.has(event.pointerId)) return;
    const before = [...g.pointers.values()];
    const point = pointIn(ref.current, event);
    g.pointers.set(event.pointerId, point);
    if (!g.moved && g.start && distance(point, g.start) < TAP_SLOP_PX && g.pointers.size === 1) return;
    if (!g.moved) {
      g.moved = true;
      // Captured only once it is a gesture, so a tap still reaches the chart
      // underneath (its tooltip).
      ref.current.setPointerCapture?.(event.pointerId);
    }
    const after = [...g.pointers.values()];
    update((current, vp) => viewAfterMove(current, before, after, content, vp));
  }

  function onPointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    const point = g.pointers.get(event.pointerId);
    g.pointers.delete(event.pointerId);
    if (g.pointers.size > 0 || g.moved || !point || !view || !viewport || event.type === "pointercancel") return;
    const now = event.timeStamp;
    const double = g.lastTap && now - g.lastTap.at < DOUBLE_TAP_MS && distance(point, g.lastTap.point) < TAP_SLOP_PX * 3;
    g.lastTap = double ? null : { at: now, point };
    if (!double || width === null) return;
    update((current, vp) =>
      isZoomed(current, content, vp.width) ? fittedView(content, vp.width) : zoomAt(current, DOUBLE_TAP_ZOOM, point, content, vp),
    );
  }

  function zoomBy(factor: number) {
    update((current, vp) => zoomAt(current, factor, { x: vp.width / 2, y: vp.height / 2 }, content, vp));
  }

  return {
    active,
    view,
    viewport,
    zoomed: view !== null && width !== null && isZoomed(view, content, width),
    handlers: { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd },
    zoomIn: () => zoomBy(BUTTON_ZOOM),
    zoomOut: () => zoomBy(1 / BUTTON_ZOOM),
    reset: () => update((_, vp) => fittedView(content, vp.width)),
  };
}
