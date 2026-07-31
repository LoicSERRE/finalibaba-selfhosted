"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();

  function switchLocale(next: string) {
    startTransition(async () => {
      await fetch(`/api/set-locale?locale=${next}`);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-[var(--foreground)]">
        {locale === "fr" ? "Français" : "English"}
      </span>
      <div className="flex items-center gap-1 bg-[var(--surface-elevated)] rounded-lg p-1">
        {(["fr", "en"] as const).map((l) => (
          <button
            key={l}
            onClick={() => switchLocale(l)}
            aria-pressed={locale === l}
            className={`text-sm font-medium px-3 py-1.5 rounded-md min-h-[36px] min-w-[44px] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              locale === l
                ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
