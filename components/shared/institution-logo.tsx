"use client";

import { useState } from "react";
import { AVATAR_COLORS } from "@/lib/utils/palette";

function pickColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (name.codePointAt(i) ?? 0) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

type Props = {
  name: string;
  logoUrl: string | null;
  size?: number;
};

export function InstitutionLogo({ name, logoUrl, size = 28 }: Readonly<Props>) {
  const [failed, setFailed] = useState(false);
  const letter = name.trim()[0]?.toUpperCase() ?? "?";

  // Every call site renders the institution's name as visible text right
  // next to this logo - decorative here, not a second source of the name,
  // otherwise a screen reader announces the name twice per row.
  if (logoUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        aria-hidden="true"
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
      aria-hidden="true"
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
