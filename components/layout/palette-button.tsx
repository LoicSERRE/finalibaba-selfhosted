"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { openPalette } from "@/components/layout/palette-events";

type Props = {
  /** "row": label + shortcut (sidebar); "icon": icon only (phone header). */
  readonly variant?: "row" | "icon";
  readonly className?: string;
};

/** Opens the command palette (v2.15); Ctrl+K / Cmd+K does the same. */
export function PaletteButton({ variant = "row", className = "" }: Props) {
  const t = useTranslations("palette");
  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={() => openPalette()}
        aria-label={t("open")}
        title={`${t("open")} (Ctrl K)`}
        className={`inline-flex items-center justify-center w-11 h-11 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-elevated)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${className}`}
      >
        <Search size={20} aria-hidden="true" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => openPalette()}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-[var(--muted)] border border-[var(--border)] hover:text-[var(--foreground)] hover:bg-[var(--surface-elevated)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${className}`}
    >
      <Search size={16} aria-hidden="true" />
      <span className="flex-1 text-left">{t("open")}</span>
      <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-[var(--border)]">Ctrl K</kbd>
    </button>
  );
}
