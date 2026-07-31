import { formatCurrency } from "@/lib/utils/format";
import Link from "next/link";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function GoalAndPassiveIncome({
  t,
  tIncome,
  goalCents,
  goalPct,
  goalRemaining,
  netWorth,
  realYtdPassiveNetCents,
  realYtdDividendsNetCents,
  realYtdInterestNetCents,
}: {
  t: T;
  tIncome: T;
  goalCents: bigint;
  goalPct: number;
  goalRemaining: bigint;
  netWorth: bigint;
  realYtdPassiveNetCents: bigint;
  realYtdDividendsNetCents: bigint;
  realYtdInterestNetCents: bigint;
}) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-6 space-y-5">
      {/* Goal bar */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-y-1 mb-2">
          <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
            {t("goal.title", { amount: formatCurrency(goalCents, 0) })}
          </p>
          <div className="flex items-center gap-2">
            <span
              className={`text-sm font-semibold tabular-nums ${
                goalPct >= 100 ? "text-[var(--positive)]" : "text-[var(--accent-text)]"
              }`}
            >
              {goalPct}%
            </span>
            {goalRemaining > BigInt(0) && (
              <span className="text-xs text-[var(--muted)] hidden sm:inline">
                · {t("goal.remaining", { amount: formatCurrency(goalRemaining, 0) })}
              </span>
            )}
          </div>
        </div>
        <div
          className="h-3 bg-[var(--surface-elevated)] rounded-full overflow-hidden"
          role="progressbar"
          aria-valuenow={goalPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t("goal.aria", { pct: goalPct })}
        >
          <div
            className={`h-full rounded-full transition-all ${
              goalPct >= 100 ? "bg-[var(--positive)]" : "bg-[var(--accent)]"
            }`}
            style={{ width: `${goalPct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-[var(--muted)] mt-1.5">
          <span>{formatCurrency(netWorth, 0)}</span>
          <span>{formatCurrency(goalCents, 0)}</span>
        </div>
      </div>

      {/* Passive income - real, tracked (IncomeEvent), not the estimate below */}
      <div className="pt-4 border-t border-[var(--border)]">
        <div className="flex items-center justify-between gap-3 mb-3">
          <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
            {t("passive.title")}
          </p>
          <Link href="/income" className="text-xs text-[var(--accent-text)] hover:underline underline-offset-2 shrink-0">
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
            <Link href="/income" className="text-xs text-[var(--accent-text)] hover:underline underline-offset-2 shrink-0">
              {t("passive.emptyAction")}
            </Link>
          </div>
        )}
        <Link href="/tax-report" className="text-xs text-[var(--accent-text)] hover:underline underline-offset-2 inline-block mt-3">
          {t("passive.taxReportLink")}
        </Link>
      </div>
    </div>
  );
}
