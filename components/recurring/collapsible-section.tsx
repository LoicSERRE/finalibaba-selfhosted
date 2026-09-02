"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * A section header that can fold its contents away.
 *
 * Built for the suggestions list on /recurring, which sat first on the page
 * and pushed the templates you actually manage below the fold - on a busy
 * account there were eight of them. They are worth offering (that is how a
 * recurring transaction gets created without typing) but they are not what the
 * page is for.
 *
 * `defaultOpen` is the interesting part: suggestions start expanded only when
 * there is nothing else to show, which is precisely when they are the point of
 * the page rather than a distraction from it.
 */
export function CollapsibleSection({
  title,
  count,
  defaultOpen = false,
  children,
}: Readonly<{
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}>) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 min-h-[44px] text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)] uppercase tracking-wider transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`transition-transform ${open ? "" : "-rotate-90"}`}
        />
        {title}
        <span className="tabular-nums rounded-full bg-[var(--surface-elevated)] border border-[var(--border)] px-1.5 py-0.5 text-[10px]">
          {count}
        </span>
      </button>
      {open && <div className="space-y-3">{children}</div>}
    </div>
  );
}
