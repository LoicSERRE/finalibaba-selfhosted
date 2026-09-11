// Shared parsing/validation for the CSV import dialogs (transactions and
// balance history) - kept in one place so a fix here reaches both importers.

const DATE_RE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_RE_FR = /^(\d{2})\/(\d{2})\/(\d{4})$/;

// A shape that looks like a date is not a date. `new Date("2026-02-30")`
// does not fail, it rolls forward: the 30th of February lands on 2 March and
// the 31st of April on 1 May, silently, on a row the preview showed as
// accepted. Re-deriving the calendar date from its own parts is the check -
// a rolled-over date no longer matches the parts it was built from.
function isRealCalendarDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function parseCsvDate(raw: string): string | null {
  const s = raw.trim();
  const iso = DATE_RE_ISO.exec(s);
  if (iso) return isRealCalendarDate(+iso[1], +iso[2], +iso[3]) ? s : null;
  const fr = DATE_RE_FR.exec(s);
  if (fr && isRealCalendarDate(+fr[3], +fr[2], +fr[1])) return `${fr[3]}-${fr[2]}-${fr[1]}`;
  return null;
}

// Compares as UTC calendar dates, matching the UTC-noon convention used to
// store imported rows - a date is "in the future" if it's after today in UTC.
export function isFutureDate(isoDate: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return isoDate > today;
}

// Loose but strict-enough numeric check: optional leading minus, digits and
// spaces (thousands separator), optional comma/dot decimal part. Rejects
// "N/A", "-", "pending", "#REF!", "3.5abc" - values parseFloat would
// otherwise silently accept, truncate, or coerce to 0.
const NUMERIC_RE = /^-?[\d\s]+([.,]\d+)?$/;

export function looksNumeric(raw: string): boolean {
  return NUMERIC_RE.test(raw.trim());
}

/**
 * Cents from an amount as a spreadsheet actually writes it, rather than as
 * `parseCents` assumes: that one replaces the first comma with a dot and calls
 * it a decimal separator, so a file exported with the comma as a THOUSANDS
 * separator turns 1,234 EUR into 1,23 EUR - a thousandfold error, on a row the
 * preview shows as valid, with nothing to notice.
 *
 * The rules are structural, not a guess about the file:
 *
 *   - Both separators present: the LAST one is the decimal, the other groups
 *     thousands. `1.234,56` and `1,234.56` both mean 1234.56, and which is
 *     which is decided by position, not by locale.
 *   - One separator, appearing more than once: thousands. `1,234,567`.
 *   - One separator, once, followed by exactly THREE digits: thousands. This
 *     is the case that was silently wrong, and it is not a coin flip - money
 *     carries two decimals or none, never three, so `1,234` is a group.
 *   - Anything else: a decimal separator. `12,34`, `12.5`, `1234`.
 *
 * Deliberately NOT applied to `parseCents` itself, which the settings forms
 * also use for a hand-typed field where nobody writes a thousands separator
 * and the leniency is documented as relied upon.
 */
export function parseImportedCents(raw: string): bigint {
  const s = raw.trim().replace(/\s/g, "");
  const negative = s.startsWith("-");
  const digitsAndSeps = negative ? s.slice(1) : s;

  const lastComma = digitsAndSeps.lastIndexOf(",");
  const lastDot = digitsAndSeps.lastIndexOf(".");
  let decimalAt = -1;
  if (lastComma >= 0 && lastDot >= 0) {
    decimalAt = Math.max(lastComma, lastDot);
  } else if (lastComma >= 0 || lastDot >= 0) {
    const at = Math.max(lastComma, lastDot);
    const sep = digitsAndSeps[at];
    const occurrences = digitsAndSeps.split(sep).length - 1;
    const trailingDigits = digitsAndSeps.length - at - 1;
    if (occurrences === 1 && trailingDigits !== 3) decimalAt = at;
  }

  const whole = (decimalAt >= 0 ? digitsAndSeps.slice(0, decimalAt) : digitsAndSeps).replace(/[.,]/g, "");
  const fraction = decimalAt >= 0 ? digitsAndSeps.slice(decimalAt + 1) : "";
  const amount = Number.parseFloat(`${whole || "0"}.${fraction || "0"}`);
  if (Number.isNaN(amount)) return BigInt(0);
  return BigInt(Math.round(amount * 100)) * BigInt(negative ? -1 : 1);
}

export function makeHeaderNormalizer(aliases: Record<string, string>) {
  return function normalizeHeader(h: string): string {
    const key = h.trim().toLowerCase();
    return aliases[key] ?? key;
  };
}
