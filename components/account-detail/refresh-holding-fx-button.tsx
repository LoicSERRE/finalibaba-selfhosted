"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { refreshHoldingExchangeRate } from "@/lib/actions/holdings";
import { useTranslations } from "next-intl";

// Only rendered for a foreign-currency holding (holdings-table.tsx gates on
// currency !== "EUR") - on-demand multi-currency revaluation, re-fetching
// the FX rate and recomputing lastPriceCents/costBasisCents from the
// already-stored native price without reopening the edit dialog. Same
// try/catch + inline error pattern as institution-sync-button.tsx - a
// network-dependent action with no error handling is exactly the "spins
// forever with zero feedback" gap that button's own comment documents.
export function RefreshHoldingFxButton({ holdingId }: Readonly<{ holdingId: string }>) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const t = useTranslations("addHolding");

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        await refreshHoldingExchangeRate(holdingId);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : t("unknownError"));
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant="ghost" size="sm" onClick={handleClick} disabled={pending} aria-label={t("refreshFx")} title={t("refreshFx")}>
        <RefreshCw size={12} className={pending ? "animate-spin" : ""} aria-hidden="true" />
      </Button>
      {error && (
        <p role="alert" className="text-xs text-[var(--negative)] max-w-[160px]">
          {error}
        </p>
      )}
    </div>
  );
}
