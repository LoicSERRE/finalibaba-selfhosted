import { getTranslations, getLocale } from "next-intl/server";
import { AlertCircle } from "lucide-react";
import { addInterestRateChange, deleteInterestRateChange, updateAccountInterestRate } from "@/lib/actions/accounts";
import { SAVINGS_RATES_KNOWN_AT, countryPreset } from "@/lib/domain/tax-locale";
import { formatDateShort, localeToIntl } from "@/lib/utils/format";

/**
 * The annual interest rate on a savings or current account.
 *
 * This exists because the figure it edits used to be un-editable: the passive
 * income estimate matched account NAMES against a hardcoded list of French
 * regulated products, in code, on every render. A French user could not
 * correct a stale rate without a code change, and a user anywhere else got
 * nothing at all - silently, since zero passive income is indistinguishable
 * from an account that genuinely pays none.
 *
 * A plain server-rendered form, like the tax-treatment one on investment
 * accounts: nothing here needs client state.
 */
export async function InterestRateForm({
  accountId,
  interestRatePct,
  rateHistory,
  country,
  readOnly,
}: Readonly<{
  accountId: string;
  interestRatePct: number | null;
  /** What the account paid before each date, oldest first - see
   *  AccountInterestRate. The field above is what it pays now; these are what
   *  the year-end estimate values the earlier fortnights at, because a
   *  regulated rate moves mid-year and one number for all 24 of them is wrong
   *  on one side of that date by the whole spread over half a year. */
  rateHistory?: { id: string; ratePct: number; until: Date }[];
  country: string | null;
  readOnly?: boolean;
}>) {
  const t = await getTranslations("settings.tax");
  const tc = await getTranslations("common");
  if (readOnly) return null;

  const isUnset = interestRatePct === null;
  // Only shown where a suggestion could have come from a national schedule -
  // elsewhere the rate is whatever the bank offers and has no expiry to warn
  // about. See SavingsPreset: a dated fact is honest, an undated one pretends
  // to be current.
  const hasRegulatedRates = countryPreset(country).savings.length > 0;
  const intlLocale = localeToIntl(await getLocale());
  const knownAt = formatDateShort(new Date(`${SAVINGS_RATES_KNOWN_AT}T12:00:00.000Z`), intlLocale);

  return (
    <div className="border-t border-[var(--border)] px-6 py-4">
      <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-3">
        {t("interestRate")}
      </p>
      <form action={updateAccountInterestRate} className="flex items-center gap-3 flex-wrap">
        <input type="hidden" name="id" value={accountId} />
        <div className="relative">
          <input
            type="number"
            name="interestRatePct"
            step="0.01"
            min="0"
            max="100"
            inputMode="decimal"
            aria-label={t("interestRate")}
            defaultValue={interestRatePct != null ? +(interestRatePct * 100).toFixed(2) : ""}
            className="w-28 text-sm bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 pr-7 text-[var(--foreground)] tabular-nums focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 transition-colors"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">%</span>
        </div>
        <button
          type="submit"
          className="text-sm px-3 py-2 rounded-lg bg-[var(--accent)] text-white font-medium hover:opacity-90 transition-opacity"
        >
          {tc("save")}
        </button>
        <div className="basis-full space-y-1">
          {/* An unset rate contributes nothing, which is correct but silently
              indistinguishable from an account that genuinely pays none -
              exactly the failure this whole field was introduced to end. So
              it says so, rather than looking like a filled-in zero. */}
          {isUnset && (
            <p className="flex items-center gap-1.5 text-xs text-[var(--warning)]">
              <AlertCircle size={12} aria-hidden="true" />
              {t("interestRateUnset")}
            </p>
          )}
          <p className="text-xs text-[var(--muted)]">{t("interestRateHint")}</p>
          {hasRegulatedRates && (
            <p className="text-xs text-[var(--muted)] opacity-70">{t("interestRateStale", { date: knownAt })}</p>
          )}
        </div>
      </form>

      {/* Past rates. The estimate values each fortnight at the rate that
          fortnight carried, so recording "1.5% until 1 August" alongside a
          current 1.7% describes a real French regulated year exactly - where
          one number, whichever was stored, was wrong for half of it. */}
      <div className="mt-4 pt-4 border-t border-[var(--border)] space-y-2">
        <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
          {t("rateHistoryTitle")}
        </p>
        {(rateHistory ?? []).length === 0 ? (
          <p className="text-xs text-[var(--muted)]">{t("rateHistoryEmpty")}</p>
        ) : (
          <ul className="space-y-1">
            {(rateHistory ?? []).map((row) => (
              <li key={row.id} className="flex items-center gap-3 text-sm">
                <span className="tabular-nums">
                  {t("rateHistoryRow", {
                    rate: (row.ratePct * 100).toFixed(2),
                    date: formatDateShort(row.until, intlLocale),
                  })}
                </span>
                <form action={deleteInterestRateChange}>
                  <input type="hidden" name="rateId" value={row.id} />
                  <button
                    type="submit"
                    className="text-xs text-[var(--muted)] hover:text-[var(--negative)] transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    {tc("delete")}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={addInterestRateChange} className="flex items-end gap-2 flex-wrap">
          <input type="hidden" name="id" value={accountId} />
          <div className="relative">
            <input
              type="number"
              name="ratePct"
              step="0.01"
              min="0"
              max="100"
              inputMode="decimal"
              aria-label={t("rateHistoryRateLabel")}
              placeholder="1.50"
              className="w-24 text-sm bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 pr-7 text-[var(--foreground)] tabular-nums focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 transition-colors"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">%</span>
          </div>
          <input
            type="date"
            name="until"
            aria-label={t("rateHistoryUntilLabel")}
            className="text-sm bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 transition-colors"
          />
          <button
            type="submit"
            className="text-sm px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--surface-elevated)] transition-colors"
          >
            {t("rateHistoryAdd")}
          </button>
          <p className="basis-full text-xs text-[var(--muted)]">{t("rateHistoryHint")}</p>
        </form>
      </div>
    </div>
  );
}
