"use client";

import { useState, useTransition } from "react";
import { Coins } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createIncomeEventFromTransaction, markSimilarTransactionsAsIncome } from "@/lib/actions/income";
import { useTranslations } from "next-intl";

type IncomeType = "DIVIDEND" | "INTEREST";
type Propagation = { type: IncomeType; ticker: string; siblingCount: number };
type T = ReturnType<typeof useTranslations>;

const DIVIDEND_ACCOUNT_TYPES = new Set(["INVESTMENT", "CRYPTO", "CHECKING"]);
const INTEREST_ACCOUNT_TYPES = new Set(["CHECKING", "SAVINGS"]);

// The Dividende/Intérêts toggle, only shown when the account is ambiguous
// (CHECKING can carry either - see the module docblock below). Extracted
// so MarkAsIncomeButton's own cognitive complexity stays under the
// sonarjs/typescript:S3776 gate.
function TypeToggle({ type, setType, t }: Readonly<{ type: IncomeType; setType: (t: IncomeType) => void; t: T }>) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("type")}</span>
      <div className="flex rounded-lg overflow-hidden border border-[var(--border)]">
        {(["DIVIDEND", "INTEREST"] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={type === candidate}
            onClick={() => setType(candidate)}
            className={`flex-1 py-2 min-h-[44px] text-xs font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${
              type === candidate ? "bg-[var(--accent)]/15 text-[var(--accent-text)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {t(candidate === "DIVIDEND" ? "dividend" : "interest")}
          </button>
        ))}
      </div>
    </div>
  );
}

// The "apply to other transactions with this label too" step, shown after
// a successful mark - kept as its own component for the same complexity-
// budget reason as TypeToggle above.
function PropagationPrompt({
  propagation,
  applyPending,
  onDismiss,
  onConfirm,
  t,
}: Readonly<{
  propagation: Propagation;
  applyPending: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
  t: T;
}>) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--foreground)]">
        {t("markSimilarBody", {
          count: propagation.siblingCount,
          suffix: propagation.siblingCount !== 1 ? "s" : "",
          typeLabel: t(propagation.type === "DIVIDEND" ? "dividend" : "interest"),
        })}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDismiss} disabled={applyPending}>
          {t("markSimilarDismiss")}
        </Button>
        <Button onClick={onConfirm} disabled={applyPending}>
          {applyPending ? t("markingSimilar") : t("markSimilarConfirm", { count: propagation.siblingCount })}
        </Button>
      </div>
    </div>
  );
}

/**
 * "Mark as income" - lets the user create an IncomeEvent directly from a
 * real Transaction row instead of retyping amount/date by hand on /income.
 * Only rendered for eligible transactions (a credit, on an account type
 * that can carry DIVIDEND or INTEREST, not already linked to an
 * IncomeEvent) - see the eligibility check in the caller
 * (transactions-table.tsx).
 *
 * The type toggle only appears when the account is ambiguous (CHECKING can
 * carry either, since Trade Republic's combined cash account holds both
 * dividends and interest - see lib/actions/income.ts's
 * ELIGIBLE_ACCOUNT_TYPES comment); SAVINGS locks to INTEREST since that's
 * its only valid type.
 *
 * A single Dialog whose *content* switches between the form and the
 * propagation prompt (`propagation` state below), not two separate
 * `<Dialog>`s toggled open/closed in sequence - an earlier version used two
 * and hit a real bug in manual browser testing: closing the first
 * (`setOpen(false)`) and opening the second in the same state update left
 * both mounted simultaneously, stacked, at least transiently. One
 * continuously-open dialog that swaps its children has no such transition
 * to get wrong.
 */
export function MarkAsIncomeButton({
  transactionId,
  accountType,
  amountEuro,
  date,
  alreadyMarked,
}: Readonly<{
  transactionId: string;
  accountType: string;
  amountEuro: string;
  date: string; // YYYY-MM-DD
  alreadyMarked: boolean;
}>) {
  const canDividend = DIVIDEND_ACCOUNT_TYPES.has(accountType);
  const canInterest = INTEREST_ACCOUNT_TYPES.has(accountType);
  const ambiguous = canDividend && canInterest;

  const [open, setOpen] = useState(false);
  const [type, setType] = useState<IncomeType>(canDividend ? "DIVIDEND" : "INTEREST");
  const [pending, startTransition] = useTransition();
  const [applyPending, startApplyTransition] = useTransition();
  // null = still on the form step. Set once the mark succeeds and there
  // are sibling transactions worth offering to also mark - the dialog
  // stays open, its content just switches to the propagation prompt.
  const [propagation, setPropagation] = useState<Propagation | null>(null);
  const t = useTranslations("income");
  const tc = useTranslations("common");

  if (!canDividend && !canInterest) return null;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Reset for next time this dialog is opened, once it's fully closed.
      setType(canDividend ? "DIVIDEND" : "INTEREST");
      setPropagation(null);
    }
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("type", type);
    const ticker = (fd.get("ticker") as string) ?? "";
    startTransition(async () => {
      const { siblingCount } = await createIncomeEventFromTransaction(transactionId, fd);
      if (siblingCount > 0) {
        setPropagation({ type, ticker, siblingCount });
      } else {
        setOpen(false);
      }
    });
  }

  function handleApplyToSimilar() {
    if (!propagation) return;
    const fd = new FormData();
    fd.set("type", propagation.type);
    fd.set("ticker", propagation.ticker);
    startApplyTransition(async () => {
      await markSimilarTransactionsAsIncome(transactionId, fd);
      setOpen(false);
    });
  }

  const trigger = alreadyMarked ? (
    <span className="text-xs text-[var(--muted)]">{t("alreadyMarked")}</span>
  ) : (
    <Button variant="outline" size="sm">
      <Coins size={12} aria-hidden="true" />
      {t("markAsIncome")}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} title={propagation ? t("markSimilarTitle") : t("markAsIncomeTitle")} trigger={trigger}>
      {propagation ? (
        <PropagationPrompt
          propagation={propagation}
          applyPending={applyPending}
          onDismiss={() => setOpen(false)}
          onConfirm={handleApplyToSimilar}
          t={t}
        />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-xs text-[var(--muted)]">{t("markAsIncomeHint")}</p>

          {ambiguous && <TypeToggle type={type} setType={setType} t={t} />}

          {type === "DIVIDEND" && (
            <Input id="mai-ticker" label={t("ticker")} type="text" name="ticker" placeholder="AAPL" maxLength={20} />
          )}

          <div className="grid grid-cols-2 gap-3">
            <Input id="mai-amount" label={t("amount")} type="text" value={amountEuro} disabled readOnly />
            <Input id="mai-date" label={t("date")} type="text" value={date} disabled readOnly />
          </div>

          <Input id="mai-tax" label={t("taxWithheld")} type="text" inputMode="decimal" name="taxWithheld" placeholder="1.85" />

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? tc("saving") : t("submit")}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
