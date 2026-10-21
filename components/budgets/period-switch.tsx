import Link from "next/link";

type Period = "month" | "year";

type Props = {
  readonly active: Period;
  readonly monthHref: string;
  readonly yearHref: string;
  readonly labels: { readonly month: string; readonly year: string; readonly group: string };
};

const base =
  "px-4 min-h-[36px] inline-flex items-center text-sm rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

function periodLinkClass(current: boolean): string {
  return `${base} ${current ? "bg-[var(--surface-elevated)] text-[var(--foreground)] font-medium" : "text-[var(--muted)] hover:text-[var(--foreground)]"}`;
}

/**
 * /budgets for one month or a whole year (v2.20) - two links, no client
 * state. The links are written out rather than mapped through a helper
 * closure: a nested function swallows the component in lizard's count
 * (scripts/lizard-blind-spots.py).
 */
export function PeriodSwitch({ active, monthHref, yearHref, labels }: Props) {
  return (
    <nav aria-label={labels.group} className="flex justify-center">
      <div className="inline-flex gap-1 p-1 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <Link href={monthHref} aria-current={active === "month" ? "page" : undefined} className={periodLinkClass(active === "month")}>
          {labels.month}
        </Link>
        <Link href={yearHref} aria-current={active === "year" ? "page" : undefined} className={periodLinkClass(active === "year")}>
          {labels.year}
        </Link>
      </div>
    </nav>
  );
}
