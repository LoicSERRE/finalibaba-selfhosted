"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { recordBalance } from "@/lib/actions/balances";
import { useTranslations } from "next-intl";

export function RecordBalanceDialog({
  accountId,
  accountName,
  currentCents,
}: {
  accountId: string;
  accountName: string;
  currentCents: bigint;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const t = useTranslations("recordBalance");
  const tc = useTranslations("common");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      await recordBalance(fd);
      setOpen(false);
    });
  }

  const current = (Number(currentCents) / 100).toFixed(2);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t("title", { name: accountName })}
      trigger={
        <Button variant="outline" size="sm">
          <Pencil size={12} aria-hidden="true" />
          {t("update")}
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="accountId" value={accountId} />
        <Input
          label={t("balance")}
          name="balance"
          type="number"
          inputMode="decimal"
          step="0.01"
          defaultValue={current}
          required
        />
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
