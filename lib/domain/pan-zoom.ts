/**
 * Map-style navigation over a chart wider than a phone (v2.18.1): the whole
 * chart fitted to the screen first, pinch or double-tap to zoom, drag to move
 * once zoomed. Pure geometry; the gestures live in
 * components/ui/use-pan-zoom.ts.
 *
 * The content is drawn at its natural size and transformed with
 * `translate(x, y) scale(scale)` from its top-left corner, inside a viewport
 * as wide as the screen and as tall as the fitted content.
 */

export type View = { scale: number; x: number; y: number };
export type Size = { width: number; height: number };

/** How far past the fitted view a user can zoom in. */
export const MAX_ZOOM = 4;
/** What a double tap zooms to, relative to the fitted view. */
export const DOUBLE_TAP_ZOOM = 2.5;

/** The scale at which the whole content fits the viewport's width (never above 1). */
export function fitScale(content: Size, viewportWidth: number): number {
  return Math.min(1, viewportWidth / content.width);
}

/** The viewport the fitted content needs. */
export function viewportFor(content: Size, viewportWidth: number): Size {
  return { width: viewportWidth, height: Math.round(content.height * fitScale(content, viewportWidth)) };
}

export function fittedView(content: Size, viewportWidth: number): View {
  return clampView({ scale: fitScale(content, viewportWidth), x: 0, y: 0 }, content, viewportFor(content, viewportWidth));
}

function clampAxis(offset: number, contentLength: number, viewportLength: number): number {
  // Smaller than the viewport: centred. Larger: no gap at either edge.
  if (contentLength <= viewportLength) return (viewportLength - contentLength) / 2;
  return Math.min(0, Math.max(viewportLength - contentLength, offset));
}

/** The view moved back inside its bounds: between fitted and MAX_ZOOM, never showing past an edge. */
export function clampView(view: View, content: Size, viewport: Size): View {
  const fit = fitScale(content, viewport.width);
  const scale = Math.min(fit * MAX_ZOOM, Math.max(fit, view.scale));
  return {
    scale,
    x: clampAxis(view.x, content.width * scale, viewport.width),
    y: clampAxis(view.y, content.height * scale, viewport.height),
  };
}

/** Zoomed by `factor` around a viewport point, which stays under the finger. */
export function zoomAt(view: View, factor: number, point: { x: number; y: number }, content: Size, viewport: Size): View {
  const target = clampView({ ...view, scale: view.scale * factor }, content, viewport).scale;
  const ratio = target / view.scale;
  return clampView(
    { scale: target, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio },
    content,
    viewport,
  );
}

export function panBy(view: View, dx: number, dy: number, content: Size, viewport: Size): View {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, content, viewport);
}

/** Whether the view is zoomed in past the fitted one - what makes a drag pan rather than scroll the page. */
export function isZoomed(view: View, content: Size, viewportWidth: number): boolean {
  return view.scale > fitScale(content, viewportWidth) * 1.01;
}
