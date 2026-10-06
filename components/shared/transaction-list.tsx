import { formatCurrency } from "@/lib/utils/format";

/**
 * The transaction list used by an account's page and by /transactions.
 *
 * It replaced a <table>, and the reason is width, not taste. A table sized
 * its columns to their content and scrolled sideways when they did not fit:
 * on a phone the amount sat off-screen on every row, and even on a wide
 * desktop the account page's 896px column pushed the income button out of
 * view behind a scrollbar (both reported with screenshots). There is no
 * column layout that fits a 360px phone AND keeps six columns, so this
 * renders ONE structure that changes shape:
 *
 * - below xl, a card per transaction: label and amount on the first line,
 *   date and account under it, then the category controls and actions;
 * - from xl up, a grid whose columns are FIXED widths shared by every row
 *   (so they align like a table) except the label, which takes what is left
 *   and wraps. Nothing scrolls sideways at any width.
 *
 * xl, not md, and measured rather than guessed: the columns need about
 * 930px with the account column, and next to the 13rem sidebar that is not
 * available until 1280px - at md the first version overflowed its rows by
 * 378px (scripts/ui-audit, self-overflow check).
 *
 * One DOM, not a table plus a hidden card list: the category cell is an
 * interactive client component per row, and rendering it twice would double
 * the hydration cost and put two copies of every control in the page.
 */

const DATE_COL = "7.5rem";
const ACCOUNT_COL = "9rem";
const AMOUNT_COL = "8rem";
// Fits the widest category cell: a 140px select plus split and transfer
// buttons at 44px each, with their gaps.
const CATEGORY_COL = "15.5rem";
const ACTION_COL = "3rem";

// A plain object type with per-field readonly, not `Readonly<{...}>`: a
// top-level `type X = Readonly<{...}>` alias blinds lizard to every function
// after it in a .tsx file (documented in CLAUDE.md), and this one hid all four
// functions here from the complexity gate on its first CI run.
export type TransactionListHeaders = {
  readonly date: string;
  readonly account?: string;
  readonly label: string;
  readonly amount: string;
  readonly category: string;
  readonly actions?: readonly string[];
};

function gridTemplate(showAccount: boolean, actionCount: number): string {
  return [
    DATE_COL,
    showAccount ? ACCOUNT_COL : null,
    "minmax(8rem, 1fr)",
    AMOUNT_COL,
    CATEGORY_COL,
    ...Array.from({ length: actionCount }, () => ACTION_COL),
  ]
    .filter(Boolean)
    .join(" ");
}

export function TransactionList({
  headers,
  children,
}: Readonly<{ headers: TransactionListHeaders; children: React.ReactNode }>) {
  const showAccount = headers.account !== undefined;
  const actions = headers.actions ?? [];
  const style = { "--tx-cols": gridTemplate(showAccount, actions.length) } as React.CSSProperties;
  const headerCell = "text-xs font-medium text-[var(--muted)] uppercase tracking-wider";

  return (
    <div style={style}>
      {/* Visual column headings, desktop only. Each row's content reads in a
          sensible order on its own, so the headings are hidden from screen
          readers rather than half-mapped onto a list that is not a table. */}
      <div
        aria-hidden="true"
        className="hidden xl:grid xl:[grid-template-columns:var(--tx-cols)] gap-4 px-6 py-3 border-b border-[var(--border)]"
      >
        <span className={headerCell}>{headers.date}</span>
        {showAccount && <span className={headerCell}>{headers.account}</span>}
        <span className={headerCell}>{headers.label}</span>
        <span className={`${headerCell} text-right`}>{headers.amount}</span>
        <span className={headerCell}>{headers.category}</span>
        {actions.map((a) => (
          <span key={a} className={`${headerCell} truncate`} title={a}>
            {a}
          </span>
        ))}
      </div>
      <ul className="divide-y divide-[var(--border)]">{children}</ul>
    </div>
  );
}

function Amount({ cents }: Readonly<{ cents: bigint }>) {
  return (
    <span className={`tabular-nums font-medium whitespace-nowrap ${cents > BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
      {cents > BigInt(0) ? "+" : ""}
      {formatCurrency(cents)}
    </span>
  );
}

export function TransactionListItem({
  date,
  account,
  label,
  amountCents,
  category,
  actions = [],
}: Readonly<{
  /** Already formatted for the viewer's locale. */
  date: string;
  /** Present only when the list shows an account column. */
  account?: string;
  label: string;
  amountCents: bigint;
  category: React.ReactNode;
  /** One node per action column, in header order; null leaves the cell empty. */
  actions?: React.ReactNode[];
}>) {
  const meta = account ? `${date} · ${account}` : date;
  return (
    <li className="px-4 py-3 xl:px-6 xl:grid xl:[grid-template-columns:var(--tx-cols)] xl:items-center xl:gap-4 hover:bg-[var(--surface-elevated)] transition-colors">
      <span className="hidden xl:block text-sm text-[var(--muted)] tabular-nums whitespace-nowrap">{date}</span>
      {account !== undefined && (
        <span className="hidden xl:block text-sm text-[var(--muted)] truncate" title={account}>
          {account}
        </span>
      )}

      {/* Phone: label and amount share the first line, date and account go
          under the label. From md the amount has its own column. */}
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <p className="text-sm text-[var(--foreground)] break-words">{label}</p>
          <p className="xl:hidden text-xs text-[var(--muted)] mt-0.5 tabular-nums">{meta}</p>
        </div>
        <span className="xl:hidden shrink-0 text-sm">
          <Amount cents={amountCents} />
        </span>
      </div>
      <span className="hidden xl:block text-sm text-right">
        <Amount cents={amountCents} />
      </span>

      {/* On a phone the controls share one wrapping row; xl:contents
          dissolves the wrapper so each becomes its own grid column. */}
      <div className="flex flex-wrap items-center gap-2 mt-2 xl:mt-0 xl:contents">
        <div className="min-w-0">{category}</div>
        {actions.map((action, i) => (
          <div key={i} className="flex xl:justify-center">
            {action}
          </div>
        ))}
      </div>
    </li>
  );
}
