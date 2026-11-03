"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { renameAccount, setSyncedAccountType } from "@/lib/actions/accounts";
import { SYNCED_ACCOUNT_TYPES } from "@/lib/domain/synced-account-type";
import { useTranslations } from "next-intl";

// The one rename surface for every account type (fiat, investment, real
// estate, automobile, loan) - mounted once in AccountHeader rather than
// duplicated into each type-specific dialog (UpdateRealEstateDialog/
// UpdateAutomobileDialog already take a `name` prop, but only to render it
// in their own title, never to edit it - a real gap, there was previously
// no UI path to rename an account at all after creation).
//
// `type` is passed only for an account a Woob bank syncs (v2.22): the bank's
// classification can be wrong, and this is where the user corrects it.
export function RenameAccountDialog({ id, name, type }: Readonly<{ id: string; name: string; type?: string }>) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const t = useTranslations("renameAccount");
  const ta = useTranslations("accountTypes");
  const tc = useTranslations("common");
  const title = type ? t("editTitle") : t("title");

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      await renameAccount(fd);
      if (type && fd.get("type") !== type) await setSyncedAccountType(fd);
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={title}
      trigger={
        <button
          type="button"
          aria-label={type ? t("editTrigger") : t("trigger")}
          className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-elevated)] rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <Pencil size={14} aria-hidden="true" />
        </button>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="id" value={id} />
        <Input label={t("nameField")} name="name" type="text" defaultValue={name} required autoFocus />
        {type && (
          <div className="space-y-1.5">
            <label htmlFor="account-type" className="block text-sm font-medium text-[var(--foreground)]">
              {t("typeField")}
            </label>
            <select
              id="account-type"
              name="type"
              defaultValue={type}
              className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 transition-colors"
            >
              {SYNCED_ACCOUNT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {ta(value)}
                </option>
              ))}
            </select>
            <p className="text-xs text-[var(--muted)]">{t("typeHint")}</p>
          </div>
        )}
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
