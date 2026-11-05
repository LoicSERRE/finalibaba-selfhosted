"use client";

import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { newRowKey, type CapTableRowDraft, type DismembermentDraft } from "@/components/companies/cap-table-draft";

const labelClass = "flex flex-col gap-1 text-xs text-[var(--muted)]";
const fieldClass =
  "w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 min-h-11 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]";

/**
 * Démembrement blocks (step 3): parts split between an usufructuary and a
 * bare owner, two associates of the list above. The usufruct is valued by its
 * holder's age (art. 669 I CGI), which is why the usufructuary needs a birth
 * date - the server says so if it is missing.
 */
export function DismembermentsEditor({
  rows,
  blocks,
  onBlocksChange,
}: Readonly<{ rows: CapTableRowDraft[]; blocks: DismembermentDraft[]; onBlocksChange: (blocks: DismembermentDraft[]) => void }>) {
  const t = useTranslations("companies.wizard");
  const label = (r: CapTableRowDraft, i: number) => r.name.trim() || t("associateNameN", { n: i + 1 });
  const update = (key: string, patch: Partial<DismembermentDraft>) =>
    onBlocksChange(blocks.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  const add = () =>
    onBlocksChange([
      ...blocks,
      { key: newRowKey(), parts: "", usufructuaryKey: rows[0]?.key ?? "", bareOwnerKey: rows[1]?.key ?? "" },
    ]);

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-[var(--foreground)]">{t("dismemberments")}</p>
      <p className="text-xs text-[var(--muted)]">{t("dismembermentsHint")}</p>
      {blocks.map((b, i) => (
        <fieldset key={b.key} className="rounded-lg border border-[var(--border)] p-3 grid grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)_2.75rem] gap-2 items-end">
          <legend className="sr-only">{t("dismembermentN", { n: i + 1 })}</legend>
          <label className={labelClass}>
            {t("parts")}
            <input
              aria-label={t("dismembermentPartsN", { n: i + 1 })}
              inputMode="numeric"
              value={b.parts}
              onChange={(e) => update(b.key, { parts: e.target.value.replace(/\D/g, "") })}
              className={`${fieldClass} font-mono tabular-nums`}
            />
          </label>
          <label className={labelClass}>
            {t("usufructuary")}
            <select value={b.usufructuaryKey} onChange={(e) => update(b.key, { usufructuaryKey: e.target.value })} className={fieldClass}>
              {rows.map((r, j) => <option key={r.key} value={r.key}>{label(r, j)}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            {t("bareOwner")}
            <select value={b.bareOwnerKey} onChange={(e) => update(b.key, { bareOwnerKey: e.target.value })} className={fieldClass}>
              {rows.map((r, j) => <option key={r.key} value={r.key}>{label(r, j)}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={() => onBlocksChange(blocks.filter((x) => x.key !== b.key))}
            aria-label={t("removeDismembermentN", { n: i + 1 })}
            className="inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={add}
        disabled={rows.length < 2}
        className="inline-flex items-center gap-1.5 min-h-11 text-sm text-[var(--accent-text)] hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
      >
        <Plus size={14} aria-hidden="true" />
        {t("addDismemberment")}
      </button>
    </div>
  );
}
