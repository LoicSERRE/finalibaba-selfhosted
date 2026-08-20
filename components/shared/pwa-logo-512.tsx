// Shared 512x512 logo glyph for the two generated PWA manifest icon routes
// (app/icon-512/route.tsx, app/icon-512-maskable/route.tsx) - "any" renders
// it full-bleed, matching public/icon.svg's own proportions exactly;
// "maskable" additionally shrinks and centers the glyph into a safe zone so
// Android's circular/rounded-square icon mask never crops it, per
// https://web.dev/articles/maskable-icon. Coordinates are computed from
// icon.svg's own 100x100 viewBox via real arithmetic below, not hand-copied
// as decimals, so the two variants (and any future edit to the logo shape)
// can never visually drift out of sync with each other or with icon.svg.
const VIEWBOX_TO_CANVAS = 512 / 100;
const MASKABLE_SAFE_ZONE = 0.62; // fraction of full size the glyph occupies when maskable
const CANVAS_CENTER = 256;

function pos(v: number, maskable: boolean): number {
  const full = v * VIEWBOX_TO_CANVAS;
  return maskable ? CANVAS_CENTER + (full - CANVAS_CENTER) * MASKABLE_SAFE_ZONE : full;
}

function size(v: number, maskable: boolean): number {
  const full = v * VIEWBOX_TO_CANVAS;
  return maskable ? full * MASKABLE_SAFE_ZONE : full;
}

export function Logo512({ maskable }: Readonly<{ maskable: boolean }>) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        background: "linear-gradient(135deg, #6366f1, #4338ca)",
        // A maskable icon must fill the canvas edge-to-edge - the OS applies
        // its own mask shape (circle, squircle, rounded square...), so a
        // pre-rounded background here would double up with - or fight - that
        // mask. Only the "any" variant gets its own rounded corners.
        borderRadius: maskable ? 0 : size(22, false),
      }}
    >
      {/* F - vertical bar */}
      <div style={{ position: "absolute", left: pos(22, maskable), top: pos(19, maskable), width: size(13, maskable), height: size(62, maskable), background: "white", borderRadius: size(3.5, maskable) }} />
      {/* F - top horizontal */}
      <div style={{ position: "absolute", left: pos(22, maskable), top: pos(19, maskable), width: size(52, maskable), height: size(13, maskable), background: "white", borderRadius: size(3.5, maskable) }} />
      {/* F - middle horizontal */}
      <div style={{ position: "absolute", left: pos(22, maskable), top: pos(45, maskable), width: size(38, maskable), height: size(11, maskable), background: "white", borderRadius: size(3.5, maskable) }} />
      {/* Trend bars (green, bottom-right) */}
      <div style={{ position: "absolute", left: pos(44, maskable), top: pos(74, maskable), width: size(8, maskable), height: size(8, maskable), background: "#22c55e", borderRadius: size(2, maskable) }} />
      <div style={{ position: "absolute", left: pos(56, maskable), top: pos(67, maskable), width: size(8, maskable), height: size(15, maskable), background: "#22c55e", borderRadius: size(2, maskable) }} />
      <div style={{ position: "absolute", left: pos(68, maskable), top: pos(59, maskable), width: size(8, maskable), height: size(23, maskable), background: "#22c55e", borderRadius: size(2, maskable) }} />
    </div>
  );
}
