import { describe, expect, it } from "vitest";
import { MAX_ZOOM, clampView, fittedView, isZoomed, panBy, viewportFor, zoomAt } from "@/lib/domain/pan-zoom";

/**
 * Map-style navigation over the money-flow chart on a phone (v2.18.1): the
 * chart fitted whole first, zoom that keeps the point under the finger
 * still, and no way to drag it off screen.
 */

const CHART = { width: 520, height: 400 };
const PHONE = 312; // a 360px phone minus the card's padding
const viewport = viewportFor(CHART, PHONE);

describe("the fitted view", () => {
  it("shows the whole chart at the phone's width", () => {
    const view = fittedView(CHART, PHONE);
    expect(view.scale).toBeCloseTo(0.6, 5);
    expect(view.x).toBeCloseTo(0, 5);
    expect(view.y).toBeCloseTo(0, 5);
    expect(viewport).toEqual({ width: PHONE, height: 240 });
    expect(isZoomed(view, CHART, PHONE)).toBe(false);
  });

  it("never enlarges a chart that already fits", () => {
    expect(fittedView(CHART, 800).scale).toBe(1);
  });
});

describe("zooming", () => {
  it("keeps the point under the fingers where it was", () => {
    const fitted = fittedView(CHART, PHONE);
    const point = { x: 200, y: 100 };
    const zoomed = zoomAt(fitted, 2, point, CHART, viewport);
    // The chart coordinate under the point is the same before and after.
    const before = { x: (point.x - fitted.x) / fitted.scale, y: (point.y - fitted.y) / fitted.scale };
    const after = { x: (point.x - zoomed.x) / zoomed.scale, y: (point.y - zoomed.y) / zoomed.scale };
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
    expect(isZoomed(zoomed, CHART, PHONE)).toBe(true);
  });

  it("stays between the fitted view and MAX_ZOOM times it", () => {
    const fitted = fittedView(CHART, PHONE);
    expect(zoomAt(fitted, 0.2, { x: 0, y: 0 }, CHART, viewport).scale).toBeCloseTo(fitted.scale, 5);
    expect(zoomAt(fitted, 50, { x: 0, y: 0 }, CHART, viewport).scale).toBeCloseTo(fitted.scale * MAX_ZOOM, 5);
  });
});

describe("panning", () => {
  it("moves a zoomed chart, but never past its edges", () => {
    const zoomed = zoomAt(fittedView(CHART, PHONE), 2, { x: 0, y: 0 }, CHART, viewport);
    const moved = panBy(zoomed, -50, -30, CHART, viewport);
    expect(moved.x).toBeCloseTo(zoomed.x - 50, 5);
    expect(moved.y).toBeCloseTo(zoomed.y - 30, 5);
    // Dragged far right: the chart's left edge stops at the viewport's.
    expect(panBy(zoomed, 5000, 5000, CHART, viewport)).toMatchObject({ x: 0, y: 0 });
    // Dragged far left: its right edge stops at the viewport's.
    const far = panBy(zoomed, -5000, -5000, CHART, viewport);
    expect(far.x + CHART.width * far.scale).toBeCloseTo(viewport.width, 5);
    expect(far.y + CHART.height * far.scale).toBeCloseTo(viewport.height, 5);
  });

  it("does not move the fitted chart at all", () => {
    const fitted = fittedView(CHART, PHONE);
    expect(panBy(fitted, 80, 80, CHART, viewport)).toEqual(clampView(fitted, CHART, viewport));
  });
});
