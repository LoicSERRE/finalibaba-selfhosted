"use client";

import { useRef } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { usePanZoom } from "@/components/ui/use-pan-zoom";

// Per-field readonly: a Readonly<{...}> props type hides the component from
// lizard (scripts/lizard-blind-spots.py).
type Props = {
  /** The content's natural size: drawn at this size, fitted and zoomed on narrow screens. */
  readonly width: number;
  readonly height: number;
  readonly labels: { readonly zoomIn: string; readonly zoomOut: string; readonly reset: string; readonly hint: string };
  readonly children: React.ReactNode;
};

const BUTTON =
  "inline-flex items-center justify-center w-11 h-11 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-[var(--foreground)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

/**
 * Map-style navigation (v2.18.1) for content wider than the screen: fitted
 * whole at first, then pinch, double tap or the buttons to zoom, and drag to
 * move once zoomed in. Where the content fits (a desktop), it renders as is,
 * at full width - no gesture, no control.
 */
export function PanZoom({ width, height, labels, children }: Props) {
  const measureRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const pz = usePanZoom({ width, height }, measureRef, areaRef);

  if (!pz.active || !pz.view || !pz.viewport) {
    return (
      <div ref={measureRef} style={{ height }}>
        {children}
      </div>
    );
  }

  const { scale, x, y } = pz.view;
  return (
    <div ref={measureRef} className="space-y-2">
      <div
        ref={areaRef}
        {...pz.handlers}
        className="relative overflow-hidden rounded-lg select-none"
        // While fitted, a vertical drag still scrolls the page; once zoomed
        // in, every drag is the chart's.
        style={{ height: pz.viewport.height, touchAction: pz.zoomed ? "none" : "pan-y" }}
      >
        <div
          style={{ width, height, transform: `translate(${x}px, ${y}px) scale(${scale})`, transformOrigin: "0 0" }}
        >
          {children}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--muted)]">{labels.hint}</p>
        <div className="flex gap-1.5 shrink-0">
          <button type="button" className={BUTTON} onClick={pz.zoomOut} aria-label={labels.zoomOut} disabled={!pz.zoomed}>
            <Minus size={16} aria-hidden="true" />
          </button>
          <button type="button" className={BUTTON} onClick={pz.zoomIn} aria-label={labels.zoomIn}>
            <Plus size={16} aria-hidden="true" />
          </button>
          <button type="button" className={BUTTON} onClick={pz.reset} aria-label={labels.reset} disabled={!pz.zoomed}>
            <Maximize2 size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
