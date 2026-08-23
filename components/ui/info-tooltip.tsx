"use client";

import * as Popover from "@radix-ui/react-popover";
import { Info } from "lucide-react";
import { useTranslations } from "next-intl";

// Collapses a dense, footnote-style explanatory paragraph behind a small
// "i" icon, shown on click/tap - not hover-only, since hover has no touch
// equivalent and this app is used on mobile. Click/tap works uniformly on
// both mouse and touch devices, avoiding a two-trigger-mode component.
// Styled after the floating-panel token combo this app already uses for
// Recharts tooltips (bg-[var(--surface-elevated)] border border-[var(--border)]
// rounded text-sm) - the closest existing "small floating info box"
// precedent, no other Tooltip/Popover component existed before this one.
export function InfoTooltip({ children }: Readonly<{ children: React.ReactNode }>) {
  const t = useTranslations("common");
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t("moreInfo")}
          className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-elevated)] rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <Info size={14} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          className="z-50 max-w-xs bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--muted)] shadow-2xl"
        >
          {children}
          <Popover.Arrow className="fill-[var(--surface-elevated)]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
