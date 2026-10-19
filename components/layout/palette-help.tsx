"use client";

import { useTranslations } from "next-intl";
import { GO_SHORTCUTS } from "@/lib/domain/shortcuts";

const ROUTE_LABEL: Record<string, string> = {
  "/": "pages.dashboard",
  "/accounts": "pages.accounts",
  "/transactions": "pages.transactions",
  "/budgets": "pages.budgets",
  "/recurring": "pages.recurring",
  "/income": "pages.income",
  "/analytics": "pages.analytics",
  "/tax-report": "pages.taxReport",
  "/settings": "pages.settings",
};

const KBD = "inline-block min-w-[1.5rem] text-center text-[11px] font-mono px-1.5 py-0.5 rounded border border-[var(--border)] bg-[var(--surface-elevated)]";

/** Every keyboard shortcut, in one list (v2.15). Opened with "?". */
export function PaletteHelp() {
  const t = useTranslations("palette");
  const rows: Array<{ keys: string[]; label: string }> = [
    { keys: ["Ctrl", "K"], label: t("help.palette") },
    { keys: ["?"], label: t("help.help") },
    { keys: ["H"], label: t("help.discretion") },
    ...Object.entries(GO_SHORTCUTS).map(([key, href]) => ({ keys: ["g", key], label: t(ROUTE_LABEL[href]) })),
  ];
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">{t("help.intro")}</p>
      <ul className="divide-y divide-[var(--border)]">
        {rows.map((row) => (
          <li key={row.keys.join("+")} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="text-[var(--foreground)]">{row.label}</span>
            <span className="flex gap-1">
              {row.keys.map((key) => (
                <kbd key={key} className={KBD}>
                  {key}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
