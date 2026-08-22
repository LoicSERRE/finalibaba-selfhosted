"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { setTransactionSplits, clearTransactionSplits } from "@/lib/actions/transaction-splits";
import { formatCurrency } from "@/lib/utils/format";
import { useTranslations } from "next-intl";

type Category = { id: string; name: string; color: string };
type ExistingSplit = { categoryId: string | null; amountCents: bigint };

function parseEuroToCents(euroString: string): number {
  const n = Number.parseFloat(euroString.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// Split one transaction across 2+ categories - see CLAUDE.md's "Split
// transactions" for the full design (why the transaction's own categoryId
// goes null once split, the magnitude-only UI with the sign inferred
// server-side, etc.). Reused for both "create a new split" (initialSplits
// empty) and "edit an existing one" (pre-filled) - the same dialog either
// way, distinguished only by whether the "remove split" action is offered.
export function SplitTransactionDialog({
  transactionId,
  amountCents,
  categories,
  initialSplits,
  trigger,
}: Readonly<{
  transactionId: string;
  amountCents: bigint;
  categories: Category[];
  initialSplits: ExistingSplit[];
  trigger: React.ReactNode;
}>) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const t = useTranslations("categories");
  const tc = useTranslations("common");
  const isEdit = initialSplits.length > 0;

  const totalAbsCents = Number(amountCents < BigInt(0) ? -amountCents : amountCents);

  // Each row carries a stable client-only id (never sent to the server -
  // setTransactionSplits only reads categoryId/amountEuro) purely so React
  // has something better than array index to key on: index-based keys would
  // misattribute focus/input state across rows after removeRow splices the
  // array, e.g. typing into row 2 then deleting row 1 would keep row 2's
  // DOM input (now rendered at index 0) showing row 1's old value.
  const [rows, setRows] = useState<{ id: string; categoryId: string; amountEuro: string }[]>(() =>
    isEdit
      ? initialSplits.map((l) => ({
          id: crypto.randomUUID(),
          categoryId: l.categoryId ?? "",
          amountEuro: (Number(l.amountCents < BigInt(0) ? -l.amountCents : l.amountCents) / 100).toFixed(2),
        }))
      : [
          { id: crypto.randomUUID(), categoryId: "", amountEuro: "" },
          { id: crypto.randomUUID(), categoryId: "", amountEuro: "" },
        ],
  );

  const enteredCents = rows.reduce((sum, r) => sum + parseEuroToCents(r.amountEuro), 0);
  const remainingCents = totalAbsCents - enteredCents;
  const linesFilled = rows.length >= 2 && rows.every((r) => r.amountEuro.trim() !== "" && parseEuroToCents(r.amountEuro) > 0);
  const canSave = remainingCents === 0 && linesFilled;

  function updateRow(index: number, patch: Partial<{ categoryId: string; amountEuro: string }>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function addRow() {
    setRows((prev) => [...prev, { id: crypto.randomUUID(), categoryId: "", amountEuro: "" }]);
  }

  function handleSave() {
    startTransition(async () => {
      await setTransactionSplits(
        transactionId,
        rows.map((r) => ({ categoryId: r.categoryId || null, amountEuro: r.amountEuro })),
      );
      setOpen(false);
    });
  }

  function handleRemoveSplit() {
    startTransition(async () => {
      await clearTransactionSplits(transactionId);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen} title={isEdit ? t("splitDialogTitleEdit") : t("splitDialogTitleCreate")} trigger={trigger}>
      <div className="space-y-4">
        <p className="text-xs text-[var(--muted)]">{t("splitDialogHint", { amount: formatCurrency(totalAbsCents) })}</p>

        <div className="space-y-3">
          {rows.map((row, i) => (
            <div key={row.id} className="flex items-end gap-2">
              <div className="flex-1">
                <Select
                  label={i === 0 ? t("splitCategoryLabel") : undefined}
                  aria-label={i === 0 ? undefined : t("splitCategoryLabel")}
                  options={[{ value: "", label: t("uncategorized") }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
                  value={row.categoryId}
                  onChange={(e) => updateRow(i, { categoryId: e.target.value })}
                />
              </div>
              <div className="w-28 shrink-0">
                <Input
                  label={i === 0 ? t("splitAmountLabel") : undefined}
                  aria-label={i === 0 ? undefined : t("splitAmountLabel")}
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={row.amountEuro}
                  onChange={(e) => updateRow(i, { amountEuro: e.target.value })}
                />
              </div>
              {rows.length > 2 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t("splitRemoveLine")}
                  onClick={() => removeRow(i)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </Button>
              )}
            </div>
          ))}
        </div>

        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus size={14} aria-hidden="true" />
          {t("splitAddLine")}
        </Button>

        <p className={`text-sm font-medium ${remainingCents === 0 ? "text-[var(--positive)]" : "text-[var(--muted)]"}`}>
          {remainingCents === 0 ? t("splitBalanced") : t("splitRemaining", { amount: formatCurrency(remainingCents) })}
        </p>

        <div className="flex items-center justify-between gap-2 pt-2">
          {isEdit ? (
            <Button type="button" variant="destructive" size="sm" onClick={handleRemoveSplit} disabled={pending}>
              {t("splitRemove")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="button" onClick={handleSave} disabled={!canSave || pending}>
              {pending ? t("saving") : t("submit")}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
