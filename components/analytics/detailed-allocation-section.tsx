import { formatCurrency } from "@/lib/utils/format";
import { TruncatedText } from "@/components/ui/truncated-text";
import type { AllocationSliceResult } from "@/lib/domain/analytics";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function DetailedAllocationSection({
  t,
  tAlloc,
  allocationSlices,
  totalAllocation,
}: Readonly<{
  t: T;
  tAlloc: T;
  allocationSlices: AllocationSliceResult[];
  totalAllocation: number;
}>) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--border)]">
        <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
          {t("detailedAllocation.title")}
        </h2>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {allocationSlices.map((slice) => {
          const pct = totalAllocation > 0
            ? Math.round((slice.value / totalAllocation) * 100)
            : 0;
          const name = tAlloc(slice.key as Parameters<typeof tAlloc>[0]);
          return (
            <div key={slice.key} className="px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-2 sm:gap-4">
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: slice.color }}
              />
              {/* shrink-0 alone doesn't cap width for an unbreakable single
                  word (e.g. "Investissements"): the flex item's implicit
                  min-width:auto let it grow past its own w-20/w-32 to fit
                  the text, visually overflowing into the progress bar next
                  to it. TruncatedText handles the truncation itself and
                  makes the full name reachable by tap, not just hover -
                  a bare title= attribute has no touch equivalent, so a
                  truncated name was simply unreadable on mobile before. */}
              <TruncatedText text={name} className="text-sm text-[var(--foreground)] w-20 sm:w-32 shrink-0" />
              <div className="flex-1 h-1.5 bg-[var(--surface-elevated)] rounded-full overflow-hidden" aria-hidden="true">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, background: slice.color }}
                />
              </div>
              <span className="text-xs sm:text-sm tabular-nums text-[var(--muted)] w-8 sm:w-10 text-right shrink-0">
                {pct}%
              </span>
              <span className="text-xs sm:text-sm tabular-nums font-medium text-[var(--foreground)] w-16 sm:w-28 text-right shrink-0">
                {formatCurrency(slice.value, 0)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
