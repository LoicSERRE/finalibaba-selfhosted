"use client";

export const dynamic = "force-dynamic";

// This replaces the ENTIRE root layout (Next.js only reaches for
// global-error.tsx when the error happened inside app/layout.tsx itself),
// so nothing from layout.tsx - the font loader, the NextIntlClientProvider,
// the sidebar - is available here. Re-importing the stylesheet directly is
// the supported pattern for this specific boundary; Tailwind's classes below
// still resolve because its content scan covers the whole project, not just
// files that import globals.css.
import "./globals.css";

export default function GlobalError({
  reset,
}: Readonly<{
  reset: () => void;
}>) {
  return (
    <html lang="fr" className="h-full">
      <body className="h-full flex items-center justify-center bg-[var(--background)] text-[var(--foreground)] antialiased">
        <div className="text-center px-6">
          <p className="text-sm text-[var(--muted)] mb-4">Une erreur inattendue s&apos;est produite.</p>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-lg font-medium transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] bg-[var(--accent-strong)] text-white hover:bg-[var(--accent-strong)]/85 active:scale-[0.97] active:opacity-90 px-4 py-2 text-sm min-h-[44px]"
          >
            Réessayer
          </button>
        </div>
      </body>
    </html>
  );
}
