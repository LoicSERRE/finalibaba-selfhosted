"use client";

import { useState } from "react";

const COLORS = [
  "#6366f1", "#8b5cf6", "#3b82f6", "#06b6d4",
  "#22c55e", "#f59e0b", "#ec4899", "#ef4444",
];

function pickColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

type Props = {
  name: string;
  logoUrl: string | null;
  size?: number;
};

export function InstitutionLogo({ name, logoUrl, size = 28 }: Props) {
  const [failed, setFailed] = useState(false);
  const letter = name.trim()[0]?.toUpperCase() ?? "?";

  if (logoUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={name}
        width={size}
        height={size}
        onError={() => setFailed(true)}
        className="rounded-md object-contain flex-shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className="flex-shrink-0 rounded-md flex items-center justify-center text-white font-semibold select-none"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.45,
        backgroundColor: pickColor(name),
      }}
    >
      {letter}
    </span>
  );
}
