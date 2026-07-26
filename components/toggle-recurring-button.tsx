"use client";

import { useTransition } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toggleRecurringActive } from "@/lib/actions/recurring";
import { useTranslations } from "next-intl";

export function ToggleRecurringButton({ id, active }: { id: string; active: boolean }) {
  const [pending, startTransition] = useTransition();
  const t = useTranslations("recurring");

  function handleClick() {
    startTransition(async () => {
      await toggleRecurringActive(id, !active);
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={pending}
      aria-label={active ? t("pause") : t("resume")}
    >
      {active ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
    </Button>
  );
}
