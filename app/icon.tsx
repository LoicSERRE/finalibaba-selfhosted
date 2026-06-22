import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          borderRadius: "7px",
        }}
      >
        <span
          style={{
            color: "white",
            fontSize: 22,
            fontWeight: 800,
            fontFamily: "sans-serif",
            letterSpacing: "-0.5px",
          }}
        >
          F
        </span>
      </div>
    ),
    { ...size }
  );
}
