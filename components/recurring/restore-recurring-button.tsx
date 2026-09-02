"use client";

import { useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { restoreRecurringTransaction } from "@/lib/actions/recurring";

/** Brings a dismissed pattern back as a paused template, so hiding one is
 *  never a one-way door. */
export function RestoreRecurringButton({ id }: Readonly<{ id: string }>) {
  const [pending, startTransition] = useTransition();
  const t = useTranslations("recurring");

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(async () => { await restoreRecurringTransaction(id); })}
    >
      <RotateCcw size={14} aria-hidden="true" />
      {pending ? t("restoring") : t("restore")}
    </Button>
  );
}
