"use client";

import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { capTableDraft, partsPct } from "@/lib/domain/company";

/** One row being edited. `parts` stays a string while typed. */
export type CapTableRowDraft = {
  key: string;
  id?: string;
  name: string;
  parts: string;
  username: string;
  /** The person editing: linked to themselves, no username to type. */
  self: boolean;
};

let nextKey = 0;
export function newRowKey(): string {
  nextKey += 1;
  return `row-${nextKey}`;
}

/** The rows as the Server Actions take them - validated again over there. */
export function toCapTableInput(rows: CapTableRowDraft[]) {
  return rows.map((r) => ({
    ...(r.id ? { id: r.id } : {}),
    name: r.name.trim(),
    parts: Number(r.parts),
    username: r.self ? null : r.username.trim() || null,
    self: r.self,
  }));
}

const inputClass =
  "w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 min-h-11 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]";

/**
 * Associates and their parts, with the live total the cap table must hit
 * exactly (lib/domain/company.ts). Used by the creation guide and by the
 * company page's editor; the server checks the same invariant on save.
 */
export function CapTableEditor({
  totalParts,
  rows,
  onRowsChange,
}: Readonly<{ totalParts: number; rows: CapTableRowDraft[]; onRowsChange: (rows: CapTableRowDraft[]) => void }>) {
  const t = useTranslations("companies.wizard");
  const draft = capTableDraft(totalParts, rows.map((r) => Number(r.parts)));

  const update = (key: string, patch: Partial<CapTableRowDraft>) =>
    onRowsChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">{t("associatesHint")}</p>
      <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_6rem_minmax(0,1fr)_2.75rem] gap-2 text-xs text-[var(--muted)]">
        <span>{t("associateName")}</span>
        <span>{t("parts")}</span>
        <span>{t("username")}</span>
        <span />
      </div>
      {rows.map((row, i) => (
        <div
          key={row.key}
          className="grid grid-cols-[minmax(0,1fr)_6rem_2.75rem] sm:grid-cols-[minmax(0,1fr)_6rem_minmax(0,1fr)_2.75rem] gap-2 items-center"
        >
          <input
            aria-label={t("associateNameN", { n: i + 1 })}
            value={row.name}
            onChange={(e) => update(row.key, { name: e.target.value })}
            className={inputClass}
          />
          <input
            aria-label={t("partsN", { n: i + 1 })}
            inputMode="numeric"
            value={row.parts}
            onChange={(e) => update(row.key, { parts: e.target.value.replace(/\D/g, "") })}
            className={`${inputClass} font-mono tabular-nums`}
          />
          {row.self ? (
            <span className="order-last sm:order-none col-span-3 sm:col-span-1 text-sm text-[var(--muted)] px-1">{t("you")}</span>
          ) : (
            <input
              aria-label={t("usernameN", { n: i + 1 })}
              value={row.username}
              onChange={(e) => update(row.key, { username: e.target.value })}
              placeholder={t("username")}
              autoComplete="off"
              className={`${inputClass} order-last sm:order-none col-span-3 sm:col-span-1`}
            />
          )}
          <button
            type="button"
            onClick={() => onRowsChange(rows.filter((r) => r.key !== row.key))}
            disabled={rows.length === 1}
            aria-label={t("removeAssociate", { n: i + 1 })}
            className="inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-elevated)] disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onRowsChange([...rows, { key: newRowKey(), name: "", parts: "", username: "", self: false }])
        }
        className="inline-flex items-center gap-1.5 min-h-11 text-sm text-[var(--accent-text)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
      >
        <Plus size={14} aria-hidden="true" />
        {t("addAssociate")}
      </button>
      <div
        className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm ${
          draft.complete
            ? "border-[var(--positive)]/40 bg-[var(--positive)]/10"
            : "border-[var(--warning)]/40 bg-[var(--warning)]/10"
        }`}
        aria-live="polite"
      >
        <span>{t("total")}</span>
        <span className={`font-mono tabular-nums ${draft.complete ? "text-[var(--positive-text)]" : "text-[var(--warning)]"}`}>
          {t("totalStatus", {
            allocated: draft.allocated,
            total: totalParts || 0,
            pct: partsPct(draft.allocated, totalParts),
          })}
        </span>
      </div>
    </div>
  );
}
