"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { formatCurrency, localeToIntl } from "@/lib/utils/format";
import { simulatePrepayment, type PrepaymentMode } from "@/lib/domain/loan-schedule";

/** The loan's terms, as plain values - nothing BigInt crosses to the client. */
export type SimulatorTerms = {
  readonly amountCents: number;
  readonly taeg: number;
  readonly durationMonths: number;
  readonly deferralMonths: number;
  readonly startDate: string;
  readonly insuranceCents: number;
};

type Props = {
  readonly terms: SimulatorTerms;
  readonly bankReported: boolean;
};

function euroCents(raw: string): number {
  const n = Number(raw.trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

/**
 * What repaying part of the loan today would change (v2.20): shorten it at
 * the same instalment, or keep its end and lower the instalment. Computed
 * as the user types, from the same schedule as the table above it.
 */
export function PrepaymentSimulator({ terms, bankReported }: Props) {
  const t = useTranslations("prepayment");
  const intlLocale = localeToIntl(useLocale());
  const [amount, setAmount] = useState("");
  const [fees, setFees] = useState("");
  const [mode, setMode] = useState<PrepaymentMode>("shorten");

  const amountCents = euroCents(amount);
  const result = useMemo(() => {
    if (amountCents === 0) return null;
    return simulatePrepayment(
      {
        loanAmountCents: BigInt(terms.amountCents),
        loanTaeg: terms.taeg,
        loanDurationMonths: terms.durationMonths,
        loanDeferralMonths: terms.deferralMonths,
        loanStartDate: new Date(terms.startDate),
      },
      terms.insuranceCents,
      { amountCents, mode, feesCents: euroCents(fees), asOf: new Date() }
    );
  }, [amountCents, fees, mode, terms]);

  const monthYear = new Intl.DateTimeFormat(intlLocale, { month: "short", year: "numeric", timeZone: "UTC" });

  return (
    <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 space-y-4" aria-labelledby="prepayment-title">
      <div>
        <h2 id="prepayment-title" className="text-base font-semibold text-[var(--foreground)]">{t("title")}</h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">{bankReported ? t("subtitleBank") : t("subtitle")}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input label={t("amount")} name="prepaymentAmount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2000" />
        <Input label={t("fees")} name="prepaymentFees" inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0" />
      </div>
      <p className="text-xs text-[var(--muted)] -mt-2">{t("feesHint")}</p>
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-1">{t("mode")}</legend>
        {(["shorten", "lower_payment"] as const).map((m) => (
          <label key={m} className="flex items-start gap-3 text-sm cursor-pointer">
            <input type="radio" name="prepaymentMode" value={m} checked={mode === m} onChange={() => setMode(m)} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
            <span>
              {t(m === "shorten" ? "shorten" : "lower")}
              <span className="block text-xs text-[var(--muted)]">{t(m === "shorten" ? "shortenHint" : "lowerHint")}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {result && (
        <div className="border-t border-[var(--border)] pt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm" aria-live="polite">
          <div>
            <p className="text-[var(--muted)] text-xs mb-1">{t("saving")}</p>
            <p className={`tabular-nums font-semibold amount ${result.netSavingCents >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
              {formatCurrency(result.netSavingCents)}
            </p>
            <p className="text-xs text-[var(--muted)] amount">
              {t("interestLeft", { before: formatCurrency(result.interestBeforeCents), after: formatCurrency(result.interestAfterCents) })}
            </p>
          </div>
          {mode === "shorten" ? (
            <div>
              <p className="text-[var(--muted)] text-xs mb-1">{t("endDate")}</p>
              <p className="tabular-nums font-semibold text-[var(--foreground)]">
                {result.endDateAfter ? monthYear.format(result.endDateAfter) : t("repaidNow")}
              </p>
              <p className="text-xs text-[var(--muted)]">{t("monthsSaved", { count: result.monthsLeftBefore - result.monthsLeftAfter })}</p>
            </div>
          ) : (
            <div>
              <p className="text-[var(--muted)] text-xs mb-1">{t("newPayment")}</p>
              <p className="tabular-nums font-semibold text-[var(--foreground)] amount">{formatCurrency(result.paymentAfterCents + terms.insuranceCents)}</p>
              <p className="text-xs text-[var(--muted)] amount">{t("insteadOf", { amount: formatCurrency(result.paymentBeforeCents + terms.insuranceCents) })}</p>
            </div>
          )}
          <div>
            <p className="text-[var(--muted)] text-xs mb-1">{t("capitalNow")}</p>
            <p className="tabular-nums font-semibold text-[var(--foreground)] amount">{formatCurrency(result.capitalBeforeCents)}</p>
            {result.repaidCents < amountCents && <p className="text-xs text-[var(--muted)]">{t("cappedToOwed")}</p>}
          </div>
        </div>
      )}
    </section>
  );
}
