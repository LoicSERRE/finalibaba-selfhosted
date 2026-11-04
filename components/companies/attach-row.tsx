"use client";

import { Button } from "@/components/ui/button";

/** One account or bank connection with its attach / remove button. */
export function AttachRow({
  name,
  detail,
  actionLabel,
  onAction,
  disabled,
}: Readonly<{ name: string; detail?: string; actionLabel: string; onAction: () => void; disabled: boolean }>) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0 break-words text-sm text-[var(--foreground)]">
        {name}
        {detail && <span className="ml-2 text-xs text-[var(--muted)]">{detail}</span>}
      </span>
      <Button variant="outline" size="sm" onClick={onAction} disabled={disabled}>
        {actionLabel}
      </Button>
    </li>
  );
}
