"use client";

import { useTransition } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { acceptRecurringPrice } from "@/lib/actions/recurring";

/** Takes a price increase on board: the template's amount becomes the new price (v2.20). */
export function AcceptPriceButton({ id, label }: { readonly id: string; readonly label: string }) {
  const [pending, startTransition] = useTransition();
  const t = useTranslations("recurring.priceIncreases");

  function accept() {
    startTransition(async () => {
      const result = await acceptRecurringPrice(id);
      toast(result.ok ? { message: t("accepted", { label }) } : { tone: "error", message: t("acceptFailed") });
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={accept} disabled={pending}>
      <Check size={12} aria-hidden="true" />
      <span>{t("accept")}</span>
    </Button>
  );
}
