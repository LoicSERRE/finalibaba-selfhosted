// Shared parsing/validation for the CSV import dialogs (transactions and
// balance history) - kept in one place so a fix here reaches both importers.

const DATE_RE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_RE_FR = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export function parseCsvDate(raw: string): string | null {
  const s = raw.trim();
  if (DATE_RE_ISO.test(s)) return s;
  const m = DATE_RE_FR.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
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

export function makeHeaderNormalizer(aliases: Record<string, string>) {
  return function normalizeHeader(h: string): string {
    const key = h.trim().toLowerCase();
    return aliases[key] ?? key;
  };
}
