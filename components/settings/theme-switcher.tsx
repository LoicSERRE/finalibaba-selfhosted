"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";

const THEMES = ["dark", "light"] as const;
type Theme = (typeof THEMES)[number];

// Mirrors components/settings/language-switcher.tsx's exact shape - no
// equivalent to next-intl's useLocale() hook exists for this, so the
// current value is passed down as a prop from the server-rendered
// Settings page (which reads the THEME cookie), rather than read here.
export function ThemeSwitcher({ theme }: Readonly<{ theme: Theme }>) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const t = useTranslations("settings.theme");

  function switchTheme(next: Theme) {
    startTransition(async () => {
      await fetch(`/api/set-theme?theme=${next}`);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-[var(--foreground)]">{t(theme)}</span>
      <div className="flex items-center gap-1 bg-[var(--surface-elevated)] rounded-lg p-1">
        {THEMES.map((th) => (
          <button
            key={th}
            type="button"
            onClick={() => switchTheme(th)}
            aria-pressed={theme === th}
            className={`text-sm font-medium px-3 py-1.5 rounded-md min-h-[36px] min-w-[44px] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              theme === th
                ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {t(th)}
          </button>
        ))}
      </div>
    </div>
  );
}
