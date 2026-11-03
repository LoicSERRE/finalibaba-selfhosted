"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { stopSyncingAccount } from "@/lib/actions/accounts";
import { useTranslations } from "next-intl";

/**
 * The delete button of an account a Woob bank syncs (v2.22). A plain delete
 * would be undone by the next sync, so this also tells the sync to skip it;
 * Settings can bring it back. Keeps the confirmation dialog rather than an
 * undo toast, like DeleteAccountButton: the account's history goes with it.
 */
export function StopSyncingAccountButton({ id, name, backHref }: Readonly<{ id: string; name: string; backHref: string }>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const t = useTranslations();

  const handleConfirm = () => {
    startTransition(async () => {
      await stopSyncingAccount(id);
      setOpen(false);
      router.push(backHref);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t("stopSyncingAccount.title")}
      trigger={
        <Button variant="destructive" size="sm">
          <CloudOff size={12} aria-hidden="true" />
          {t("stopSyncingAccount.trigger")}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--negative)]/10 border border-[var(--negative)]/20">
          <AlertTriangle size={16} className="text-[var(--negative)] shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-[var(--foreground)]">{t("stopSyncingAccount.description", { name })}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={pending}>
            <CloudOff size={12} aria-hidden="true" />
            {pending ? t("common.deleting") : t("stopSyncingAccount.confirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
