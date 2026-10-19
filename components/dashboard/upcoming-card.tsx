import Link from "next/link";
import { CalendarClock } from "lucide-react";
import type { getTranslations } from "next-intl/server";
import { formatCurrency } from "@/lib/utils/format";
import { UPCOMING_DAYS, type UpcomingSummary } from "@/lib/domain/upcoming";

type T = Awaited<ReturnType<typeof getTranslations>>;

const SHOWN = 6;

type Props = {
  readonly t: T;
  readonly upcoming: UpcomingSummary;
  readonly intlLocale: string;
};

/**
 * The month ahead (v2.16): the next expected recurring payments, money in
 * and out. Rendered by the dashboard only, not by share links - it is
 * spending detail a share link was never scoped to show.
 */
export function UpcomingCard({ t, upcoming, intlLocale }: Props) {
  const day = new Intl.DateTimeFormat(intlLocale, { weekday: "short", day: "numeric", month: "short" });
  const shown = upcoming.occurrences.slice(0, SHOWN);
  const more = upcoming.occurrences.length - shown.length;
  return (
    <section className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 sm:p-6 space-y-4" aria-labelledby="upcoming-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="upcoming-title" className="flex items-center gap-2 text-xs text-[var(--muted)] uppercase tracking-wider">
          <CalendarClock size={14} aria-hidden="true" />
          {t("dashboard.upcoming.title", { days: String(UPCOMING_DAYS) })}
        </h2>
        <Link href="/recurring" className="text-xs text-[var(--accent-text)] hover:underline">
          {t("dashboard.upcoming.seeAll")}
        </Link>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          {t("dashboard.upcoming.empty")}{" "}
          <Link href="/recurring" className="text-[var(--accent-text)] hover:underline">
            {t("dashboard.upcoming.add")}
          </Link>
        </p>
      ) : (
        <>
          <p className="text-sm text-[var(--muted)]">
            {t("dashboard.upcoming.in")} <span className="amount tabular-nums text-[var(--positive)]">+{formatCurrency(upcoming.inCents, 0)}</span>
            {" · "}
            {t("dashboard.upcoming.out")} <span className="amount tabular-nums text-[var(--negative)]">{formatCurrency(upcoming.outCents, 0)}</span>
          </p>
          <ul className="divide-y divide-[var(--border)]">
            {shown.map((o) => (
              <li key={`${o.seriesId}-${o.date.toISOString()}`} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-24 shrink-0 text-xs text-[var(--muted)] tabular-nums">{day.format(o.date)}</span>
                <span className="flex-1 min-w-0 truncate text-[var(--foreground)]">{o.label}</span>
                <span className={o.amountCents >= BigInt(0) ? "amount tabular-nums text-[var(--positive)]" : "amount tabular-nums text-[var(--negative)]"}>
                  {o.amountVaries ? "≈ " : ""}
                  {o.amountCents >= BigInt(0) ? "+" : ""}
                  {formatCurrency(o.amountCents)}
                </span>
              </li>
            ))}
          </ul>
          {more > 0 && <p className="text-xs text-[var(--muted)]">{t("dashboard.upcoming.more", { count: String(more) })}</p>}
        </>
      )}
    </section>
  );
}
