"use client";

export const dynamic = "force-dynamic";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fr">
      <body
        style={{
          background: "#0a0a0f",
          color: "#f0f0f5",
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          margin: 0,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <p style={{ color: "#6b7280", marginBottom: "1rem" }}>
            Une erreur inattendue s&apos;est produite.
          </p>
          <button
            onClick={reset}
            style={{
              background: "#6366f1",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              padding: "8px 16px",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            Réessayer
          </button>
        </div>
      </body>
    </html>
  );
}
