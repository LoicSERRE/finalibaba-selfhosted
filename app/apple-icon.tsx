import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "linear-gradient(135deg, #6366f1, #4338ca)",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "40px",
        }}
      >
        {/* F — vertical bar */}
        <div
          style={{
            position: "absolute",
            left: 40,
            top: 35,
            width: 24,
            height: 110,
            background: "white",
            borderRadius: 7,
          }}
        />
        {/* F — top horizontal */}
        <div
          style={{
            position: "absolute",
            left: 40,
            top: 35,
            width: 95,
            height: 24,
            background: "white",
            borderRadius: 7,
          }}
        />
        {/* F — middle horizontal */}
        <div
          style={{
            position: "absolute",
            left: 40,
            top: 82,
            width: 68,
            height: 20,
            background: "white",
            borderRadius: 7,
          }}
        />
        {/* Trend bars */}
        <div style={{ position: "absolute", left: 80, top: 133, width: 14, height: 14, background: "#22c55e", borderRadius: 3 }} />
        <div style={{ position: "absolute", left: 100, top: 120, width: 14, height: 27, background: "#22c55e", borderRadius: 3 }} />
        <div style={{ position: "absolute", left: 120, top: 106, width: 14, height: 41, background: "#22c55e", borderRadius: 3 }} />
      </div>
    ),
    { ...size }
  );
}
