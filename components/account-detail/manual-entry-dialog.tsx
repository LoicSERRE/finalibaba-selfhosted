"use client";

import { useState, useTransition } from "react";
import { PencilLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseCents } from "@/lib/utils/format";
import { recordManualMovement, setManualBalance } from "@/lib/actions/manual-entries";

/**
 * Recording what happened on an account nobody else writes to - a meal-voucher
 * card being the case this was asked for.
 *
 * Three modes rather than one signed amount field. "Dépense" and "Ajout" are
 * the same write with opposite signs, but asking a person to type a minus sign
 * to mean "I spent" is exactly the kind of thing that produces a +12 EUR
 * grocery run, and the sign is not recoverable from anything else once stored.
 * "Corriger le solde" is genuinely different: it writes a snapshot and NO
 * transaction, because nothing happened that a budget should count - the figure
 * was simply wrong. Its own hint says so, since a correction silently absent
 * from budgets would otherwise read as a bug.
 *
 * Rendered only where canImportCsv already holds, i.e. a fiat account with no
 * sync. The Server Actions re-derive that themselves through
 * assertManualAccountEligible; this only avoids offering a button that could
 * not succeed.
 */

type Mode = "spend" | "topup" | "correct";
type T = ReturnType<typeof useTranslations>;

const MODES: readonly Mode[] = ["spend", "topup", "correct"];
const MODE_LABEL: Record<Mode, string> = {
  spend: "modeSpend",
  topup: "modeTopup",
  correct: "modeCorrect",
};

// Its own component so the dialog below stays under the
// sonarjs/cognitive-complexity gate, same reason MarkAsIncomeButton splits
// out its own type toggle.
function ModeToggle({ mode, setMode, t }: Readonly<{ mode: Mode; setMode: (m: Mode) => void; t: T }>) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-[var(--border)]">
      {MODES.map((candidate) => (
        <button
          key={candidate}
          type="button"
          aria-pressed={mode === candidate}
          onClick={() => setMode(candidate)}
          className={`flex-1 py-2 min-h-[44px] text-xs font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${
            mode === candidate
              ? "bg-[var(--accent)]/15 text-[var(--accent-text)]"
              : "text-[var(--muted)] hover:text-[var(--foreground)]"
          }`}
        >
          {t(MODE_LABEL[candidate])}
        </button>
      ))}
    </div>
  );
}

export function ManualEntryDialog({
  accountId,
  categories,
}: Readonly<{
  accountId: string;
  categories: { id: string; name: string; color: string }[];
}>) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("spend");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const t = useTranslations("accountDetail.manualEntry");
  const tc = useTranslations("common");

  const today = new Date().toISOString().slice(0, 10);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setMode("spend");
      setError(null);
    }
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);

    startTransition(async () => {
      if (mode === "correct") {
        const result = await setManualBalance(accountId, Number(parseCents(String(fd.get("balance") ?? ""))));
        if (!result.ok) {
          setError(t(ERROR_KEY[result.error]));
          return;
        }
        setOpen(false);
        return;
      }

      // The sign is decided here, from the mode, never typed. Math.abs so a
      // minus sign typed anyway cannot flip a spend back into a credit.
      const magnitude = Math.abs(Number(parseCents(String(fd.get("amount") ?? ""))));
      const result = await recordManualMovement(accountId, {
        amountCents: mode === "spend" ? -magnitude : magnitude,
        label: String(fd.get("label") ?? ""),
        date: String(fd.get("date") ?? ""),
        categoryId: (fd.get("categoryId") as string) || null,
      });
      if (!result.ok) {
        setError(t(ERROR_KEY[result.error]));
        return;
      }
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t("title")}
      trigger={
        <Button variant="outline" size="sm">
          <PencilLine size={12} aria-hidden="true" />
          {t("trigger")}
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <ModeToggle mode={mode} setMode={setMode} t={t} />

        {mode === "correct" ? (
          <Input
            name="balance"
            label={t("newBalance")}
            hint={t("correctHint")}
            type="text"
            inputMode="decimal"
            placeholder="87,50"
            required
            autoFocus
          />
        ) : (
          <>
            <Input
              name="amount"
              label={t("amount")}
              hint={t("movementHint")}
              type="text"
              inputMode="decimal"
              placeholder="12,50"
              required
              autoFocus
            />
            <Input name="label" label={t("label")} type="text" maxLength={500} required />
            <Input name="date" label={t("date")} type="date" defaultValue={today} max={today} required />
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="manual-entry-category"
                className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider"
              >
                {t("category")}
              </label>
              <select
                id="manual-entry-category"
                name="categoryId"
                defaultValue=""
                className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 transition-colors"
              >
                <option value="">{t("noCategory")}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="text-xs text-[var(--negative)]">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => handleOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? tc("saving") : tc("save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Stable keys from the Server Action mapped to the strings both locales
 *  carry - the actions deliberately return keys rather than sentences. */
const ERROR_KEY: Record<string, string> = {
  amount_required: "errorAmountRequired",
  label_required: "errorLabelRequired",
  future_date: "errorFutureDate",
  invalid_date: "errorInvalidDate",
  not_found: "errorNotFound",
  not_manual: "errorNotManual",
};
