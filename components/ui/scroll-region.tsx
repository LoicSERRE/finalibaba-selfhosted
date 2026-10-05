/**
 * A horizontally scrolling container a keyboard user can reach.
 *
 * Wide tables scroll inside their own box so the page never scrolls sideways
 * on a phone - but a box with nothing focusable inside cannot be scrolled
 * from the keyboard at all, so the overflowing columns were unreachable
 * without a mouse or a touchscreen (axe `scrollable-region-focusable`, found
 * by the v2.12 visual audit). Focusable, and named, so a screen reader
 * announces what the region holds when focus lands on it.
 */
export function ScrollRegion({
  label,
  className = "",
  children,
}: Readonly<{ label: string; className?: string; children: React.ReactNode }>) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={`overflow-x-auto rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${className}`}
    >
      {children}
    </div>
  );
}
