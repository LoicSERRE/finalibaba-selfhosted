import { formatCurrency } from "@/lib/utils/format";
import Link from "next/link";
import type { getTranslations } from "next-intl/server";
import type { GoalRow } from "@/lib/domain/analytics";

type T = Awaited<ReturnType<typeof getTranslations>>;

// One goal's own progress bar (v1.14 - was inline for the single old
// global goal, now mapped once per Goal below).
function GoalProgressBar({ goal, t }: Readonly<{ goal: GoalRow; t: T }>) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-y-1 mb-2">
        <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
          {t("goal.title", { name: goal.name, amount: formatCurrency(goal.targetCents, 0) })}
        </p>
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-semibold tabular-nums ${
              goal.pct >= 100 ? "text-[var(--positive)]" : "text-[var(--accent-text)]"
            }`}
          >
            {goal.pct}%
          </span>
          {goal.remaining > BigInt(0) && (
            <span className="text-xs text-[var(--muted)] hidden sm:inline">
              · {t("goal.remaining", { amount: formatCurrency(goal.remaining, 0) })}
            </span>
          )}
        </div>
      </div>
      {/* Suppressed via sonar-project.properties (typescript:S6819) - see
          automobile-section.tsx: native <progress> can't express this
          threshold-based color-coded fill without vendor-prefixed
          pseudo-elements; full ARIA is already present below. */}
      <div
        className="h-3 bg-[var(--surface-elevated)] rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={goal.pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("goal.aria", { pct: goal.pct })}
      >
        <div
          className={`h-full rounded-full transition-all ${
            goal.pct >= 100 ? "bg-[var(--positive)]" : "bg-[var(--accent)]"
          }`}
          style={{ width: `${goal.pct}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-[var(--muted)] mt-1.5">
        <span>{formatCurrency(goal.currentCents, 0)}</span>
        <span>{formatCurrency(goal.targetCents, 0)}</span>
      </div>
    </div>
  );
}

export function GoalAndPassiveIncome({
  t,
  tIncome,
  goals,
  realYtdPassiveNetCents,
  realYtdDividendsNetCents,
  realYtdInterestNetCents,
}: Readonly<{
  t: T;
  tIncome: T;
  goals: GoalRow[];
  realYtdPassiveNetCents: bigint;
  realYtdDividendsNetCents: bigint;
  realYtdInterestNetCents: bigint;
}>) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-6 space-y-5">
      {/* Goals - zero goals renders nothing here rather than a dedicated
          empty state (a user who deletes every goal isn't missing a core
          feature the way an empty alert-rules list would be - Analytics
          has plenty else to show), matching how the passive-income half
          below already degrades gracefully via its own realYtdPassiveNetCents
          gate. */}
      {goals.length > 0 && (
        <div className="space-y-5">
          {goals.map((goal) => (
            <GoalProgressBar key={goal.id} goal={goal} t={t} />
          ))}
        </div>
      )}

      {/* Passive income - real, tracked (IncomeEvent), not the estimate below.
          The top border/padding only makes sense when a goal section is
          rendered above it - otherwise it'd be a stray divider line at the
          very top of the card. */}
      <div className={goals.length > 0 ? "pt-4 border-t border-[var(--border)]" : undefined}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
            {t("passive.title")}
          </p>
          <Link href="/income" className="text-xs text-[var(--accent-text)] hover:underline underline-offset-2 shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]">
            {t("passive.viewDetail")}
          </Link>
        </div>
        {realYtdPassiveNetCents > BigInt(0) ? (
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            <div>
              <p className="text-xs text-[var(--muted)] mb-1">{tIncome("ytdDividends")}</p>
              <p className="text-lg font-semibold tabular-nums text-[var(--positive)]">
                {formatCurrency(realYtdDividendsNetCents, 0)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--muted)] mb-1">{tIncome("ytdInterest")}</p>
              <p className="text-lg font-semibold tabular-nums text-[var(--positive)]">
                {formatCurrency(realYtdInterestNetCents, 0)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--muted)] mb-1">{tIncome("ytdTotal")}</p>
              <p className="text-lg font-semibold tabular-nums text-[var(--positive)]">
                {formatCurrency(realYtdPassiveNetCents, 0)}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-[var(--muted)]">{t("passive.emptyPrompt")}</p>
            <Link href="/income" className="text-xs text-[var(--accent-text)] hover:underline underline-offset-2 shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]">
              {t("passive.emptyAction")}
            </Link>
          </div>
        )}
        <Link
          href="/tax-report"
          className="text-xs text-[var(--accent-text)] hover:underline underline-offset-2 inline-block mt-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
        >
          {t("passive.taxReportLink")}
        </Link>
      </div>
    </div>
  );
}
