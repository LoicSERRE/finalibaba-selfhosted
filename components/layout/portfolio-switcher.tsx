"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { setViewingPortfolio } from "@/lib/actions/sharing";

export type PortfolioOption = { userId: string; label: string };

/**
 * Switches which portfolio the read surfaces show (H6) - the viewer's own, or
 * one someone granted them read-only access to.
 *
 * Only rendered when at least one grant exists, so a solo instance never sees
 * it. The selection is a cookie, re-validated against a real PortfolioGrant on
 * every read (see getViewContext) - it's a UI preference, never a claim, and a
 * revoked grant silently resolves back to your own data.
 */
export function PortfolioSwitcher({
  options,
  currentId,
  selfLabel,
}: Readonly<{ options: PortfolioOption[]; currentId: string; selfLabel: string }>) {
  const t = useTranslations("nav");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(currentId);

  function handleChange(next: string) {
    setValue(next);
    startTransition(async () => {
      // "self" rather than the real id: the action clears the cookie for
      // anything that isn't a real grant, so it never has to be told which
      // user the viewer is.
      await setViewingPortfolio(next === "self" ? null : next);
      router.refresh();
    });
  }

  const viewingOther = value !== "self";

  return (
    <div className="px-1 pb-3">
      <label htmlFor="portfolio-switcher" className="sr-only">
        {t("viewingPortfolio")}
      </label>
      <div className="relative">
        <select
          id="portfolio-switcher"
          value={value}
          disabled={pending}
          onChange={(e) => handleChange(e.target.value)}
          className={`w-full appearance-none text-xs rounded-lg border px-2.5 py-2 pr-7 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
            viewingOther
              ? "bg-[var(--accent)]/15 border-[var(--accent)]/40 text-[var(--accent-text)]"
              : "bg-[var(--surface-elevated)] border-[var(--border)] text-[var(--muted)]"
          }`}
        >
          <option value="self">{selfLabel}</option>
          {options.map((o) => (
            <option key={o.userId} value={o.userId}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={13}
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 opacity-60"
        />
      </div>
      {viewingOther && (
        <p className="flex items-center gap-1 text-[11px] text-[var(--muted)] mt-1.5 px-0.5">
          <Eye size={11} aria-hidden="true" />
          {t("readOnlyView")}
        </p>
      )}
    </div>
  );
}
