"use client";

import { createContext, useContext, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { offerUndo } from "@/components/shared/offer-undo";
import { bulkCategorizeTransactions, bulkMarkInternalTransfers } from "@/lib/actions/transactions";

/**
 * Multi-select on /transactions (v2.14). The ledger is server-rendered, so
 * selection lives in this small client context: one checkbox per row, a
 * "select the whole page" box, and a toolbar that sticks to the top of the
 * list while anything is selected (the bottom of the screen belongs to the
 * toasts). The page keys the provider on its filters and page number, so a
 * selection never survives into rows nobody is looking at.
 */

type Selection = {
  selected: ReadonlySet<string>;
  toggle: (id: string, on: boolean) => void;
  setAll: (on: boolean) => void;
  clear: () => void;
};

const SelectionContext = createContext<Selection | null>(null);

function useSelection(): Selection {
  const value = useContext(SelectionContext);
  if (!value) throw new Error("Bulk selection used outside its provider.");
  return value;
}

export function BulkSelectionProvider({ pageIds, children }: Readonly<{ pageIds: string[]; children: React.ReactNode }>) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const value = useMemo<Selection>(
    () => ({
      selected,
      toggle: (id, on) =>
        setSelected((prev) => {
          const next = new Set(prev);
          if (on) next.add(id);
          else next.delete(id);
          return next;
        }),
      setAll: (on) => setSelected(on ? new Set(pageIds) : new Set()),
      clear: () => setSelected(new Set()),
    }),
    [selected, pageIds]
  );
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

const CHECKBOX = "w-5 h-5 cursor-pointer accent-[var(--accent)]";

export function RowSelectCheckbox({ id, label }: Readonly<{ id: string; label: string }>) {
  const { selected, toggle } = useSelection();
  const t = useTranslations("transactions.bulk");
  return (
    <input
      type="checkbox"
      data-row-select=""
      checked={selected.has(id)}
      onChange={(e) => toggle(id, e.target.checked)}
      aria-label={t("selectRow", { label })}
      className={`${CHECKBOX} mt-0.5 xl:mt-0`}
    />
  );
}

const FIELD =
  "min-h-[40px] px-3 py-2 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 cursor-pointer";

type Category = { id: string; name: string };

type Translate = (key: string, values?: Record<string, string | number>) => string;
type CommonTranslate = Parameters<typeof offerUndo>[2];

const plural = (n: number) => (n > 1 ? "s" : "");

/**
 * Run a bulk edit and report it; true when the selection should clear. Kept
 * out of the component: the same logic as nested closures made lizard drop
 * this file's components from its report (dev-docs/release-audit.md, item 2).
 */
async function runBulkCategorize(ids: string[], categoryId: string | null, t: Translate, tc: CommonTranslate, refresh: () => void) {
  const result = await bulkCategorizeTransactions(ids, categoryId);
  if (!result.ok) {
    toast({ tone: "error", message: t("failed") });
    return false;
  }
  const { updated, skippedSplit, undoToken } = result.data;
  const parts = [t("categorized", { count: updated, suffix: plural(updated) })];
  if (skippedSplit > 0) parts.push(t("skippedSplit", { count: skippedSplit, suffix: plural(skippedSplit) }));
  offerUndo(parts.join(" · "), undoToken, tc, refresh);
  return true;
}

async function runBulkMarkTransfers(ids: string[], t: Translate, tc: CommonTranslate, refresh: () => void) {
  const result = await bulkMarkInternalTransfers(ids);
  if (!result.ok) {
    toast({ tone: "error", message: t("failed") });
    return false;
  }
  const { updated, undoToken } = result.data;
  offerUndo(t("marked", { count: updated, suffix: plural(updated) }), undoToken, tc, refresh);
  return true;
}

export function BulkToolbar({ pageIds, categories }: Readonly<{ pageIds: string[]; categories: Category[] }>) {
  const { selected, setAll, clear } = useSelection();
  const t = useTranslations("transactions.bulk");
  const tc = useTranslations("common");
  const router = useRouter();
  const [categoryId, setCategoryId] = useState("");
  const [pending, startTransition] = useTransition();
  const count = selected.size;
  const allOnPage = count > 0 && pageIds.every((id) => selected.has(id));

  const done = (ok: boolean) => {
    if (ok) clear();
  };
  const applyCategory = () => {
    const ids = [...selected];
    startTransition(async () => done(await runBulkCategorize(ids, categoryId || null, t, tc, router.refresh)));
  };
  const markTransfers = () => {
    const ids = [...selected];
    startTransition(async () => done(await runBulkMarkTransfers(ids, t, tc, router.refresh)));
  };

  return (
    <div
      className={`sticky top-2 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 px-4 xl:px-6 py-2.5 border-b border-[var(--border)] ${
        count > 0 ? "bg-[var(--surface-elevated)] shadow-md rounded-t-xl" : "bg-[var(--surface)] rounded-t-xl"
      }`}
    >
      <label className="flex items-center gap-2 text-sm text-[var(--muted)] cursor-pointer select-none">
        <input
          type="checkbox"
          checked={allOnPage}
          ref={(el) => {
            if (el) el.indeterminate = count > 0 && !allOnPage;
          }}
          onChange={(e) => setAll(e.target.checked)}
          className={CHECKBOX}
        />
        {count > 0 ? (
          <span className="text-[var(--foreground)] font-medium" aria-live="polite">
            {t("selected", { count, suffix: plural(count) })}
          </span>
        ) : (
          t("selectPage")
        )}
      </label>

      {count > 0 && (
        <>
          <div className="flex items-center gap-2">
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              aria-label={t("categoryLabel")}
              className={FIELD}
              disabled={pending}
            >
              <option value="">{t("uncategorized")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={applyCategory} disabled={pending}>
              <Check size={14} aria-hidden="true" />
              {t("apply")}
            </Button>
          </div>
          <Button size="sm" variant="outline" onClick={markTransfers} disabled={pending}>
            <ArrowLeftRight size={14} aria-hidden="true" />
            {t("markTransfer")}
          </Button>
          <button
            type="button"
            onClick={clear}
            disabled={pending}
            className="ml-auto inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--foreground)] px-2 py-1.5 rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <X size={14} aria-hidden="true" />
            {t("clear")}
          </button>
        </>
      )}
    </div>
  );
}
