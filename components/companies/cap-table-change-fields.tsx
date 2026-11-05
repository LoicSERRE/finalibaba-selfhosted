"use client";

import { useLocale, useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { formatDateShort, localeToIntl } from "@/lib/utils/format";

export const CHANGE_KINDS = ["CORRECTION", "CESSION", "DONATION", "CAPITAL_CHANGE"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];
export type EnteredAs = "after" | "before";
const SIDES: EnteredAs[] = ["after", "before"];

const selectClass =
  "w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 min-h-11 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] cursor-pointer";

/**
 * What a cap table save is (step 5): a correction of the cap table in force,
 * or a change - cession, donation, change of capital - on a date. The parts
 * entered are the cap table after that change (recorded as it happens) or
 * before it (filling in the past of a company entered later).
 */
export function CapTableChangeFields({
  kind,
  onKindChange,
  date,
  onDateChange,
  enteredAs,
  onEnteredAsChange,
  today,
  currentFrom,
}: Readonly<{
  kind: ChangeKind;
  onKindChange: (kind: ChangeKind) => void;
  /** "YYYY-MM-DD" */
  date: string;
  onDateChange: (date: string) => void;
  enteredAs: EnteredAs;
  onEnteredAsChange: (side: EnteredAs) => void;
  today: string;
  /** When the cap table in force today started, "YYYY-MM-DD". */
  currentFrom: string;
}>) {
  const t = useTranslations("companies.capTable");
  const intl = localeToIntl(useLocale());
  const olderThanCurrent = enteredAs === "after" && date !== "" && date < currentFrom;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cap-table-kind" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
            {t("kindLabel")}
          </label>
          <select id="cap-table-kind" value={kind} onChange={(e) => onKindChange(e.target.value as ChangeKind)} className={selectClass}>
            {CHANGE_KINDS.map((k) => (
              <option key={k} value={k}>{t(`kindOption.${k}`)}</option>
            ))}
          </select>
        </div>
        {kind === "CORRECTION" ? (
          <p className="text-xs text-[var(--muted)] sm:self-end sm:pb-2">{t("correctionHint")}</p>
        ) : (
          <Input
            label={t("effectiveFrom")}
            type="date"
            max={today}
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            hint={olderThanCurrent ? t("olderThanCurrent", { date: formatDateShort(new Date(`${currentFrom}T12:00:00.000Z`), intl) }) : undefined}
          />
        )}
      </div>
      {kind !== "CORRECTION" && (
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("enteredAsLabel")}</legend>
          {SIDES.map((side) => (
            <label key={side} className="flex items-start gap-2 min-h-11 py-1 text-sm text-[var(--foreground)] cursor-pointer">
              <input
                type="radio"
                name="cap-table-entered-as"
                value={side}
                checked={enteredAs === side}
                onChange={() => onEnteredAsChange(side)}
                className="mt-1 accent-[var(--accent)]"
              />
              <span>
                {t(`enteredAs.${side}`)}
                <span className="block text-xs text-[var(--muted)]">{t(`enteredAsHint.${side}`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
