"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * App-wide confirmation toasts (v2.13). A module-level store rather than a
 * context, so anything - a Server Action's caller after its row has already
 * unmounted, typically - can raise one with `toast(...)`. <Toaster/> is
 * mounted once in the root layout.
 */

export type ToastAction = { label: string; onClick: () => void | Promise<void> };

type ToastItem = {
  id: number;
  message: string;
  tone: "success" | "error";
  action?: ToastAction;
  durationMs: number;
};

const MAX_VISIBLE = 3;
let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function toast(input: { message: string; tone?: ToastItem["tone"]; action?: ToastAction; durationMs?: number }): number {
  const id = nextId++;
  const item: ToastItem = {
    id,
    message: input.message,
    tone: input.tone ?? "success",
    action: input.action,
    // An undo needs time to be read and reached; a plain confirmation does not.
    durationMs: input.durationMs ?? (input.action ? 8000 : 4000),
  };
  items = [...items, item].slice(-MAX_VISIBLE);
  emit();
  return id;
}

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => items;
const getServerSnapshot = (): ToastItem[] => [];

export function Toaster() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const t = useTranslations("common");
  return (
    // The live region is the permanent container, not each toast: a region
    // inserted together with its text is not reliably announced.
    <section
      aria-label={t("notifications")}
      aria-live="polite"
      // Above the phone bottom nav (z-50, ~4.5rem tall), bottom-right on desktop.
      className="fixed z-[60] left-4 right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] md:left-auto md:right-6 md:bottom-6 md:w-96 flex flex-col gap-2 pointer-events-none"
    >
      {current.map((item) => (
        <ToastCard key={item.id} item={item} dismissLabel={t("dismiss")} />
      ))}
    </section>
  );
}

function ToastCard({ item, dismissLabel }: Readonly<{ item: ToastItem; dismissLabel: string }>) {
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const remaining = useRef(item.durationMs);
  const startedAt = useRef(0);

  // Counts down only while nobody is reading it: hovering or focusing the
  // toast (keyboard users tabbing to "Annuler") holds it on screen.
  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const timer = setTimeout(() => dismissToast(item.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused, item.id]);

  const Icon = item.tone === "error" ? AlertCircle : CheckCircle2;

  async function runAction() {
    if (!item.action || busy) return;
    setBusy(true);
    try {
      await item.action.onClick();
    } finally {
      dismissToast(item.id);
    }
  }

  return (
    <div
      role={item.tone === "error" ? "alert" : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3 shadow-lg text-sm text-[var(--foreground)]"
    >
      <Icon
        size={16}
        aria-hidden="true"
        className={`shrink-0 ${item.tone === "error" ? "text-[var(--negative)]" : "text-[var(--positive)]"}`}
      />
      <p className="flex-1 min-w-0 break-words">{item.message}</p>
      {item.action && (
        <button
          type="button"
          onClick={runAction}
          disabled={busy}
          className="shrink-0 rounded-md px-2.5 py-1.5 min-h-[36px] font-semibold text-[var(--accent-text)] hover:bg-[var(--accent)]/15 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismissToast(item.id)}
        aria-label={dismissLabel}
        className="shrink-0 rounded-md p-1.5 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
