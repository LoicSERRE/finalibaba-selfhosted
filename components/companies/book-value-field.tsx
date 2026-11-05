"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { setBuildingBookValue } from "@/lib/actions/companies";
import { centsToEuro, parseCents } from "@/lib/utils/format";

/** The manager's input for one building's net book value (step 4). */
export function BookValueField({
  accountId,
  name,
  bookValueCents,
}: Readonly<{ accountId: string; name: string; bookValueCents: number | null }>) {
  const t = useTranslations("companies");
  const router = useRouter();
  const [value, setValue] = useState(bookValueCents === null ? "" : centsToEuro(bookValueCents).replace(".", ","));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // Malformed or negative goes to the server as typed, which refuses it.
      const cents = value.trim() ? Number(parseCents(value)) : null;
      const result = await setBuildingBookValue(accountId, cents);
      if (!result.ok) {
        setError(t(`errors.${result.error}`));
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          aria-label={t("tax.bookValueOf", { name })}
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("tax.bookValuePlaceholder")}
          className="w-36 bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 min-h-11 text-sm font-mono tabular-nums text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
        />
        <Button variant="outline" size="sm" onClick={save} disabled={saving}>
          {t("tax.save")}
        </Button>
      </div>
      {error && <p role="alert" className="text-xs text-[var(--negative-text)]">{error}</p>}
    </div>
  );
}
