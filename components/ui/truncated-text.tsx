"use client";

import * as Popover from "@radix-ui/react-popover";

// A `title=` attribute is hover-only, which has no equivalent on a touch
// device - a label truncated with an ellipsis had no way to be read in
// full on mobile at all (real user feedback: this needs to follow the
// same tap-to-reveal standard as InfoTooltip, not rely on hover). This
// wraps truncated text in a tap/click trigger for a small popover showing
// the untruncated string, on both mouse and touch - same Radix Popover
// mechanism as components/ui/info-tooltip.tsx, just triggered by the text
// itself instead of a separate "i" icon, since the text IS the thing
// being revealed. `title` is kept too as a harmless hover affordance for
// desktop mouse users who never click.
export function TruncatedText({
  text,
  className,
}: Readonly<{
  text: string;
  className?: string;
}>) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          title={text}
          className={`text-left truncate cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${className ?? ""}`}
        >
          {text}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          className="z-50 max-w-xs bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--foreground)] shadow-2xl break-words"
        >
          {text}
          <Popover.Arrow className="fill-[var(--surface-elevated)]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
