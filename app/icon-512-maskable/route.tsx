import { ImageResponse } from "next/og";
import { Logo512 } from "@/components/shared/pwa-logo-512";

export const contentType = "image/png";
export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(<Logo512 maskable={true} />, { width: 512, height: 512 });
}
