"use client";

import type { FlowNode } from "@/lib/domain/money-flow";

type NodeProps = {
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly payload?: FlowNode;
};

const MAX_LABEL = 18;

/**
 * One Sankey node (v2.16): its bar and its name - sources labelled on their
 * right, spending on its left, so labels never sit on top of the flows.
 * Amounts are in the list under the chart, where discretion can blur them.
 */
export function MoneyFlowNode({ x = 0, y = 0, width = 0, height = 0, payload }: NodeProps) {
  if (!payload) return null;
  const right = payload.kind !== "target";
  const name = payload.name.length > MAX_LABEL ? `${payload.name.slice(0, MAX_LABEL - 1)}…` : payload.name;
  return (
    <g>
      <rect x={x} y={y} width={width} height={Math.max(height, 2)} fill={payload.color} rx={2} />
      <text
        x={right ? x + width + 6 : x - 6}
        y={y + height / 2}
        textAnchor={right ? "start" : "end"}
        dominantBaseline="middle"
        className="fill-[var(--foreground)] text-[11px]"
      >
        {name}
      </text>
    </g>
  );
}
