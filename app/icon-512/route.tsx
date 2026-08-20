import { ImageResponse } from "next/og";
import { Logo512 } from "@/components/shared/pwa-logo-512";

// Not the icon.tsx/apple-icon.tsx file-convention (those are for browser
// tabs / iOS home screen, already covered) - a plain Route Handler so
// app/manifest.ts can reference a real 512x512 PNG explicitly, the size
// most install prompts and app stores expect. See pwa-logo-512.tsx.
export const contentType = "image/png";
// Purely static content (no request-time data) - force prerendering at
// build time instead of computing this on every request, same as the
// icon.tsx/apple-icon.tsx file-convention routes already get automatically.
export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(<Logo512 maskable={false} />, { width: 512, height: 512 });
}
