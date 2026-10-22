import { getLocale, getTranslations } from "next-intl/server";
import { formatCurrency, formatDateShort, localeToIntl } from "@/lib/utils/format";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { totalSetAside, type SetAside } from "@/lib/domain/set-aside";
import type { LedgerLine, OtherMovements } from "@/lib/domain/period-ledger";
import { movementNames } from "@/components/budgets/flow-names";

type Props = {
  readonly resteAVivreCents: number;
  readonly setAside: SetAside;
  readonly other: OtherMovements;
  readonly otherLines: readonly LedgerLine[];
  readonly currentChangeCents: number;
};

/** The detail list stops here; the rows above it always count every line. */
const MAX_LISTED = 50;

/** The sign before the amount, so a row reads as what it adds or takes. */
function sign(cents: number): string {
  if (cents > 0) return "+";
  return cents < 0 ? "−" : "";
}

/**
 * Where the current accounts' money went over the period (v2.21.1), as a sum
 * that adds up: what is left to live on, minus what was set aside, plus the
 * movements that are neither - and the result is the current accounts' real
 * change, never a difference that absorbs them. Hidden when there is nothing
 * but income and spending: the "Reste à vivre" card already says it all.
 */
export async function CurrentAccountsCard({ resteAVivreCents, setAside, other, otherLines, currentChangeCents }: Props) {
  const [t, locale] = await Promise.all([getTranslations("budgets"), getLocale()]);
  const names = movementNames(t);
  const setAsideCents = totalSetAside(setAside);
  // Signed from the current accounts' side, like the movements themselves.
  const rows = [
    { key: "loanIn", name: names.loan[1], cents: other.loanInCents },
    { key: "loanOut", name: names.loan[0], cents: other.loanOutCents },
    { key: "untrackedIn", name: names.untracked[1], cents: other.untrackedInCents },
    { key: "untrackedOut", name: names.untracked[0], cents: other.untrackedOutCents },
    { key: "between", name: names.between[0], cents: other.betweenCents },
    { key: "elsewhere", name: other.elsewhereCents < 0 ? names.elsewhere[0] : names.elsewhere[1], cents: other.elsewhereCents },
  ].filter((row) => row.cents !== 0);
  if (setAsideCents === 0 && rows.length === 0) return null;

  const intlLocale = localeToIntl(locale);
  const line = "flex items-baseline justify-between gap-3";

  return (
    <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3" aria-labelledby="current-accounts-title">
      <h2 id="current-accounts-title" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider flex items-center gap-1">
        {t("movements.title")}
        <InfoTooltip>{t("movements.hint")}</InfoTooltip>
      </h2>

      <dl className="space-y-1.5 text-sm">
        <div className={line}>
          <dt className="text-[var(--muted)]">{t("resteAVivreTitle")}</dt>
          <dd className="tabular-nums amount text-[var(--foreground)]">{sign(resteAVivreCents)}{formatCurrency(Math.abs(resteAVivreCents))}</dd>
        </div>
        {setAsideCents !== 0 && (
          <div className={line}>
            <dt className="text-[var(--muted)]">{t("setAside.title")}</dt>
            <dd className="tabular-nums amount text-[var(--foreground)]">{sign(-setAsideCents)}{formatCurrency(Math.abs(setAsideCents))}</dd>
          </div>
        )}
        {rows.map((row) => (
          <div key={row.key} className={line}>
            <dt className="text-[var(--muted)]">{row.name}</dt>
            <dd className="tabular-nums amount text-[var(--foreground)]">{sign(row.cents)}{formatCurrency(Math.abs(row.cents))}</dd>
          </div>
        ))}
        <div className={`${line} border-t border-[var(--border)] pt-2 font-medium`}>
          <dt className="text-[var(--foreground)]">{currentChangeCents >= 0 ? t("movements.leftover") : t("movements.drawnCurrent")}</dt>
          <dd className={`tabular-nums amount ${currentChangeCents >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
            {sign(currentChangeCents)}
            {formatCurrency(Math.abs(currentChangeCents))}
          </dd>
        </div>
      </dl>

      {otherLines.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-[var(--muted)] hover:text-[var(--foreground)] rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] min-h-[44px] flex items-center">
            {t("movements.details", { count: otherLines.length })}
          </summary>
          <ul className="mt-2 space-y-2">
            {otherLines.slice(0, MAX_LISTED).map((tx, i) => (
              <li key={`${tx.transactionId}-${i}`} className={line}>
                <span className="min-w-0">
                  <span className="block text-[var(--foreground)] break-words">{tx.label}</span>
                  <span className="block text-xs text-[var(--muted)]">
                    {formatDateShort(tx.date, intlLocale)} · {tx.accountName}
                  </span>
                </span>
                <span className="tabular-nums amount text-[var(--foreground)] shrink-0">{sign(tx.amountCents)}{formatCurrency(Math.abs(tx.amountCents))}</span>
              </li>
            ))}
          </ul>
          {otherLines.length > MAX_LISTED && (
            <p className="mt-2 text-xs text-[var(--muted)]">{t("movements.more", { count: otherLines.length - MAX_LISTED })}</p>
          )}
        </details>
      )}
    </section>
  );
}
