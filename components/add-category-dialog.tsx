"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createCategory, updateCategory } from "@/lib/actions/categories";
import { CATEGORY_SWATCHES } from "@/lib/palette";
import { useTranslations } from "next-intl";

// Existing category to edit, passed down as plain serializable fields only —
// budgetEuro is pre-formatted server-side (e.g. "300.00"), never a BigInt.
type EditableCategory = { id: string; name: string; color: string; budgetEuro: string | null };

export function AddCategoryDialog({ category }: { category?: EditableCategory }) {
  const isEdit = !!category;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [color, setColor] = useState(category?.color ?? CATEGORY_SWATCHES[0]);
  const t = useTranslations("categories");
  const tc = useTranslations("common");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("color", color);
    startTransition(async () => {
      if (category) {
        await updateCategory(category.id, fd);
      } else {
        await createCategory(fd);
        form.reset();
        setColor(CATEGORY_SWATCHES[0]);
      }
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={isEdit ? t("edit") : t("create")}
      trigger={
        isEdit ? (
          <Button variant="outline" size="sm" aria-label={tc("edit")}>
            <Pencil size={12} aria-hidden="true" />
          </Button>
        ) : (
          <Button>
            <Plus size={14} aria-hidden="true" />
            {t("create")}
          </Button>
        )
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          id="cat-name"
          label={t("name")}
          type="text"
          name="name"
          defaultValue={category?.name}
          required
          maxLength={50}
        />

        <div className="space-y-1.5">
          <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
            {t("color")}
          </span>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                onClick={() => setColor(swatch)}
                aria-label={swatch}
                aria-pressed={color === swatch}
                className={`w-8 h-8 rounded-full cursor-pointer transition-transform ${
                  color === swatch
                    ? "ring-2 ring-offset-2 ring-[var(--accent)] ring-offset-[var(--surface)] scale-110"
                    : ""
                }`}
                style={{ background: swatch }}
              />
            ))}
          </div>
        </div>

        <Input
          id="cat-budget"
          label={t("budgetAmount")}
          type="text"
          inputMode="decimal"
          name="budget"
          placeholder="300"
          defaultValue={category?.budgetEuro ?? ""}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? t("saving") : t("submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
