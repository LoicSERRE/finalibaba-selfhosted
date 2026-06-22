"use client";

interface SparklineProps {
  values: number[]; // valeurs en centimes, ordre chronologique
}

export function Sparkline({ values }: SparklineProps) {
  if (values.length < 2) return <div className="w-20 h-7" />;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 80;
  const H = 28;

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - ((v - min) / range) * (H - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");

  const trend = values[values.length - 1] - values[0];
  const stroke =
    trend > 0
      ? "var(--positive)"
      : trend < 0
      ? "var(--negative)"
      : "var(--muted)";

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
