"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { renameAccount } from "@/lib/actions/accounts";
import { useTranslations } from "next-intl";

// The one rename surface for every account type (fiat, investment, real
// estate, automobile, loan) - mounted once in AccountHeader rather than
// duplicated into each type-specific dialog (UpdateRealEstateDialog/
// UpdateAutomobileDialog already take a `name` prop, but only to render it
// in their own title, never to edit it - a real gap, there was previously
// no UI path to rename an account at all after creation).
export function RenameAccountDialog({ id, name }: Readonly<{ id: string; name: string }>) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const t = useTranslations("renameAccount");
  const tc = useTranslations("common");

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      await renameAccount(fd);
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t("title")}
      trigger={
        <button
          type="button"
          aria-label={t("trigger")}
          className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-elevated)] rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <Pencil size={14} aria-hidden="true" />
        </button>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="id" value={id} />
        <Input label={t("nameField")} name="name" type="text" defaultValue={name} required autoFocus />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? tc("saving") : t("submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
