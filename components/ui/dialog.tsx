"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";

export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  title: string;
  // Optional supplementary context for screen readers (aria-describedby).
  // Falls back to the title so every dialog still gets a valid description
  // without every call site needing to pass one.
  description?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("common");
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dialog-overlay fixed inset-0 bg-black/60 backdrop-blur-sm z-40" />
        <RadixDialog.Content className="dialog-content fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] max-w-md max-h-[calc(100dvh-4rem)] overflow-y-auto bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl p-6">
          <div className="flex items-center justify-between mb-5">
            <RadixDialog.Title className="text-base font-semibold text-[var(--foreground)]">
              {title}
            </RadixDialog.Title>
            <RadixDialog.Close
              aria-label={t("close")}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)] transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
            >
              <X size={16} aria-hidden="true" />
            </RadixDialog.Close>
          </div>
          <RadixDialog.Description className="sr-only">{description ?? title}</RadixDialog.Description>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
