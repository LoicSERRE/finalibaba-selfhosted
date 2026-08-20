import type { MetadataRoute } from "next";

// Replaces the old static public/manifest.json - Next auto-detects and
// links this the same way it does app/icon.tsx/apple-icon.tsx, no explicit
// `metadata.manifest` entry needed in app/layout.tsx. Switched to this
// generated form specifically to reference /icon-512 and /icon-512-maskable
// (see those routes and components/shared/pwa-logo-512.tsx) - the static
// file only ever pointed at icon.svg for both "any" and "maskable" purpose,
// which is wrong for maskable: an unpadded icon gets cropped by Android's
// circular/rounded-square mask.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Finalibaba",
    short_name: "Finalibaba",
    description: "Votre patrimoine, en un coup d'œil",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0f",
    theme_color: "#6366f1",
    orientation: "portrait-primary",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512-maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
