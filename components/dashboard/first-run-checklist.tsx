import Link from "next/link";
import { CheckCircle2, Circle, ArrowRight } from "lucide-react";
import type { getTranslations } from "next-intl/server";
import type { FirstRunStep } from "@/lib/domain/first-run";
import { FirstRunHide } from "@/components/dashboard/first-run-hide";

type T = Awaited<ReturnType<typeof getTranslations>>;

type Props = {
  readonly t: T;
  readonly steps: readonly FirstRunStep[];
  /** "full" replaces the empty dashboard; "compact" sits above a dashboard that has data. */
  readonly variant: "full" | "compact";
};

/**
 * The first-run checklist (v2.17): what to do next, each step ticked by real
 * data. Only ever rendered for the viewer's own portfolio - never on a share
 * link, never on a granted one.
 */
export function FirstRunChecklist({ t, steps, variant }: Props) {
  const required = steps.filter((s) => !s.optional);
  const doneCount = required.filter((s) => s.done).length;
  return (
    <section className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 sm:p-6 space-y-4" aria-labelledby="first-run-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="first-run-title" className="text-base font-semibold text-[var(--foreground)]">
            {t(variant === "full" ? "dashboard.firstRun.titleFull" : "dashboard.firstRun.title")}
          </h2>
          <p className="text-sm text-[var(--muted)] mt-1">
            {t("dashboard.firstRun.progress", { done: String(doneCount), total: String(required.length) })}
          </p>
        </div>
        {variant === "compact" && <FirstRunHide />}
      </div>
      <div
        className="h-1.5 rounded-full bg-[var(--surface-elevated)] overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={required.length}
        aria-valuenow={doneCount}
        aria-label={t("dashboard.firstRun.progressLabel")}
      >
        <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${(doneCount / required.length) * 100}%` }} />
      </div>
      <ol className="space-y-2">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-3 rounded-lg p-3 bg-[var(--surface-elevated)]/50">
            {step.done ? (
              <CheckCircle2 size={18} className="text-[var(--positive)] shrink-0 mt-0.5" aria-hidden="true" />
            ) : (
              <Circle size={18} className="text-[var(--muted)] shrink-0 mt-0.5" aria-hidden="true" />
            )}
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${step.done ? "text-[var(--muted)] line-through" : "text-[var(--foreground)]"}`}>
                {t(`dashboard.firstRun.steps.${step.id}.title`)}
                {step.optional && <span className="ml-2 text-xs font-normal text-[var(--muted)] no-underline">{t("dashboard.firstRun.optional")}</span>}
                <span className="sr-only"> - {t(step.done ? "dashboard.firstRun.doneSr" : "dashboard.firstRun.todoSr")}</span>
              </p>
              {!step.done && <p className="text-xs text-[var(--muted)] mt-0.5">{t(`dashboard.firstRun.steps.${step.id}.description`)}</p>}
            </div>
            {!step.done && (
              <Link href={step.href} className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-text)] hover:underline mt-0.5">
                {t("dashboard.firstRun.go")}
                <ArrowRight size={12} aria-hidden="true" />
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
