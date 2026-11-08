import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { settingsTabHref } from "@/lib/domain/settings-tabs";

/**
 * An invitation waits on an answer only the viewer can give, and nothing
 * else in the app would tell them it exists: they are answered in Settings
 * -> Partage (a co-owned account, a shared portfolio) and on the Accounts
 * page (a company link). The dashboard is where a person lands, so it says
 * so here, with a way to each.
 */
export async function PendingInvitationsBanner({ shares, companies }: Readonly<{ shares: number; companies: number }>) {
  if (shares + companies === 0) return null;
  const t = await getTranslations("dashboard.pendingInvitations");
  const linkClass =
    "inline-flex items-center min-h-11 px-2 text-sm text-[var(--accent-text)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded";
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-4 py-2.5 text-sm"
    >
      <span className="text-[var(--foreground)]">{t("summary", { count: shares + companies })}</span>
      <span className="flex flex-wrap gap-1">
        {shares > 0 && (
          <Link href={settingsTabHref("sharing")} className={linkClass}>
            {t("shares", { count: shares })}
          </Link>
        )}
        {companies > 0 && (
          <Link href="/accounts" className={linkClass}>
            {t("companies", { count: companies })}
          </Link>
        )}
      </span>
    </div>
  );
}
