import { parseCents } from "@/lib/utils/format";

/**
 * A loan's contract terms as the edit dialog sends them (v2.19.2): what a
 * bank never reports (start date, duration, deferral, insurance) and what it
 * may get wrong (amount borrowed, rate, end date). Every field is optional -
 * an empty one is stored as null, which on a bank-reported loan hands it back
 * to the bank (sync/db.py's record_loan fills only empty terms). Pure parsing
 * and validation; the write is lib/actions/loans.ts.
 */

export type LoanTerms = {
  loanAmountCents: bigint | null;
  loanTaeg: number | null;
  loanStartDate: Date | null;
  loanDurationMonths: number | null;
  loanDeferralMonths: number | null;
  insuranceMonthlyCents: bigint | null;
  loanEndDate: Date | null;
};

export type LoanTermsError =
  | "invalid_amount"
  | "invalid_rate"
  | "invalid_duration"
  | "invalid_deferral"
  | "invalid_insurance"
  | "invalid_date";

type Field = string | null | undefined;
type Parsed<T> = { ok: true; value: T | null } | { ok: false };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MONTHS = 600; // 50 years

function blank(raw: Field): boolean {
  return raw === null || raw === undefined || raw.trim() === "";
}

function money(raw: Field): Parsed<bigint> {
  if (blank(raw)) return { ok: true, value: null };
  if (!/^\d+([.,]\d{1,2})?$/.test(raw!.trim())) return { ok: false };
  return { ok: true, value: parseCents(raw!) };
}

function months(raw: Field, min: number): Parsed<number> {
  if (blank(raw)) return { ok: true, value: null };
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= MAX_MONTHS ? { ok: true, value: n } : { ok: false };
}

function day(raw: Field): Parsed<Date> {
  if (blank(raw)) return { ok: true, value: null };
  if (!ISO_DAY.test(raw!.trim())) return { ok: false };
  const date = new Date(`${raw!.trim()}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? { ok: false } : { ok: true, value: date };
}

function rate(raw: Field): Parsed<number> {
  if (blank(raw)) return { ok: true, value: null };
  const n = Number(raw!.trim().replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? { ok: true, value: n } : { ok: false };
}

// Named rather than inline: an object type in the signature hides the
// function from lizard (scripts/lizard-blind-spots.py).
export type LoanTermsFields = {
  amount?: Field;
  rate?: Field;
  startDate?: Field;
  durationMonths?: Field;
  deferralMonths?: Field;
  insurance?: Field;
  endDate?: Field;
};
type ParsedTerms = { ok: true; terms: LoanTerms } | { ok: false; error: LoanTermsError };

/** The dialog's fields, parsed and checked against each other. */
export function parseLoanTerms(fields: LoanTermsFields): ParsedTerms {
  const amount = money(fields.amount);
  if (!amount.ok) return { ok: false, error: "invalid_amount" };
  const taeg = rate(fields.rate);
  if (!taeg.ok) return { ok: false, error: "invalid_rate" };
  const duration = months(fields.durationMonths, 1);
  if (!duration.ok) return { ok: false, error: "invalid_duration" };
  const deferral = months(fields.deferralMonths, 0);
  // A deferral is part of the total duration, never all of it.
  if (!deferral.ok || (deferral.value !== null && duration.value !== null && deferral.value >= duration.value)) {
    return { ok: false, error: "invalid_deferral" };
  }
  const insurance = money(fields.insurance);
  if (!insurance.ok) return { ok: false, error: "invalid_insurance" };
  const start = day(fields.startDate);
  const end = day(fields.endDate);
  if (!start.ok || !end.ok || (start.value && end.value && end.value <= start.value)) return { ok: false, error: "invalid_date" };
  return {
    ok: true,
    terms: {
      loanAmountCents: amount.value,
      loanTaeg: taeg.value,
      loanStartDate: start.value,
      loanDurationMonths: duration.value,
      loanDeferralMonths: deferral.value,
      insuranceMonthlyCents: insurance.value,
      loanEndDate: end.value,
    },
  };
}

/** The terms as the edit dialog pre-fills them: strings, so nothing BigInt crosses to the client. */
export type LoanTermsValues = {
  readonly amount: string;
  readonly rate: string;
  readonly startDate: string;
  readonly durationMonths: string;
  readonly deferralMonths: string;
  readonly insurance: string;
  readonly endDate: string;
};

function centsText(cents: bigint | null | undefined): string {
  return cents === null || cents === undefined ? "" : (Number(cents) / 100).toFixed(2);
}

function dayText(date: Date | null | undefined): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

export function loanTermsValues(loan: {
  loanAmountCents: bigint | null;
  loanTaeg: number | null;
  loanStartDate: Date | null;
  loanDurationMonths: number | null;
  loanDeferralMonths: number | null;
  insuranceMonthlyCents: bigint | null;
  loanEndDate?: Date | null;
}): LoanTermsValues {
  return {
    amount: centsText(loan.loanAmountCents),
    rate: loan.loanTaeg === null ? "" : String(loan.loanTaeg),
    startDate: dayText(loan.loanStartDate),
    durationMonths: loan.loanDurationMonths === null ? "" : String(loan.loanDurationMonths),
    deferralMonths: loan.loanDeferralMonths === null ? "" : String(loan.loanDeferralMonths),
    insurance: centsText(loan.insuranceMonthlyCents),
    endDate: dayText(loan.loanEndDate),
  };
}
