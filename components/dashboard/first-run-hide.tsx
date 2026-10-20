"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FIRST_RUN_COOKIE } from "@/lib/domain/first-run";

/** Hides the checklist on this device (v2.17); a year, like the other UI cookies. */
export function FirstRunHide() {
  const t = useTranslations("dashboard.firstRun");
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        document.cookie = `${FIRST_RUN_COOKIE}=1; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }}
      className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] px-2 py-1 rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      {t("hide")}
    </button>
  );
}
