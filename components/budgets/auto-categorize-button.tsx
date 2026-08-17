"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { runAutoCategorizeNow } from "@/lib/actions/auto-categorize";

// Manual trigger for the self-learning label -> category engine
// (lib/domain/auto-categorize.ts) - useful for a first backfill once
// enough categorized history exists to learn from, on top of it already
// running automatically after every ~4h sync and every CSV import.
export function AutoCategorizeButton() {
  const t = useTranslations("budgets");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lastResult, setLastResult] = useState<number | null>(null);

  function handleClick() {
    startTransition(async () => {
      const { categorized } = await runAutoCategorizeNow();
      setLastResult(categorized);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      {lastResult !== null && !pending && (
        <span className="text-xs text-[var(--muted)]">
          {lastResult === 0
            ? t("autoCategorizeResultNone")
            : t("autoCategorizeResult", { count: lastResult, suffix: lastResult !== 1 ? "s" : "" })}
        </span>
      )}
      <Button variant="outline" size="sm" onClick={handleClick} disabled={pending}>
        <Sparkles size={12} aria-hidden="true" />
        {pending ? t("autoCategorizing") : t("autoCategorizeNow")}
      </Button>
    </div>
  );
}
