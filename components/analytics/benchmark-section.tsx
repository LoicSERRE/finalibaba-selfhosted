import { InfoTooltip } from "@/components/ui/info-tooltip";
import type { BenchmarkCAGRs } from "@/lib/domain/analytics";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function BenchmarkSection({
  t,
  investCAGR,
  benchmarkCAGRs,
}: Readonly<{
  t: T;
  investCAGR: number | null;
  benchmarkCAGRs: BenchmarkCAGRs | null;
}>) {
  if (benchmarkCAGRs === null || investCAGR === null) return null;

  const rows = (
    [
      ["msciWorld", benchmarkCAGRs.msciWorld],
      ["sp500", benchmarkCAGRs.sp500],
      ["cac40", benchmarkCAGRs.cac40],
    ] as const
  );

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-6">
      <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-4 flex items-center gap-1">
        {t("benchmark.title")}
        <InfoTooltip>{t("benchmark.footnote")}</InfoTooltip>
      </h2>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--foreground)]">{t("benchmark.yourPortfolio")}</span>
          <span className={`text-sm font-semibold tabular-nums ${investCAGR >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
            {investCAGR >= 0 ? "+" : ""}
            {investCAGR.toFixed(1)}%
          </span>
        </div>
        {rows.map(([key, indexCAGR]) =>
          indexCAGR !== null ? (
            <div key={key} className="flex items-center justify-between pt-3 border-t border-[var(--border)]">
              <span className="text-sm text-[var(--muted)]">{t(`benchmark.${key}`)}</span>
              <div className="flex items-center gap-2">
                <span className="text-sm tabular-nums text-[var(--muted)]">
                  {indexCAGR >= 0 ? "+" : ""}
                  {indexCAGR.toFixed(1)}%
                </span>
                <span
                  className={`text-xs font-medium tabular-nums px-1.5 py-0.5 rounded ${
                    investCAGR >= indexCAGR
                      ? "bg-[var(--positive)]/15 text-[var(--positive)]"
                      : "bg-[var(--negative)]/15 text-[var(--negative)]"
                  }`}
                >
                  {investCAGR >= indexCAGR ? "+" : ""}
                  {(investCAGR - indexCAGR).toFixed(1)} {t("benchmark.pts")}
                </span>
              </div>
            </div>
          ) : null
        )}
      </div>
    </div>
  );
}
