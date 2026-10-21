/**
 * A loan's month-by-month schedule and what an early repayment would change
 * (v2.20). Pure. Built on the same terms and the same rounded instalment as
 * lib/domain/loan.ts, so the schedule's first amortising row is the payment
 * the loan page already shows.
 *
 * Amounts are cents as numbers - the schedule is rendered and simulated in
 * the browser, where a BigInt cannot be passed from the server - each row
 * rounded to the cent, the last one settling whatever rounding left.
 */

import { calcMonthlyPayments, monthsBetween, type LoanParams } from "@/lib/domain/loan";

export type ScheduleRow = {
  /** 1-based: the n-th instalment. */
  month: number;
  date: Date;
  phase: "deferral" | "amortizing";
  /** Interest + principal, insurance excluded. */
  paymentCents: number;
  interestCents: number;
  principalCents: number;
  insuranceCents: number;
  /** Capital still owed after this instalment. */
  remainingCents: number;
};

// A schedule never runs past this, whatever the inputs (50 years).
const MAX_MONTHS = 600;

function addMonthsUtc(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate(), 12));
}

/** The constant instalment that repays `capitalCents` over `months` at monthly rate `r`. */
export function annuityCents(capitalCents: number, r: number, months: number): number {
  if (months <= 0) return capitalCents;
  if (r === 0) return Math.round(capitalCents / months);
  return Math.round((capitalCents * r) / (1 - Math.pow(1 + r, -months)));
}

type Projection = {
  capitalCents: number;
  r: number;
  deferralMonths: number;
  paymentCents: number;
  insuranceCents: number;
  /** Date of instalment 0; instalment n falls n months later. */
  from: Date;
  /**
   * A fixed term: its last instalment settles whatever the cent-rounded
   * payment left, as a bank's does, instead of trailing a month of cents.
   */
  termMonths?: number;
};

/**
 * Instalments until the capital is repaid: interest only during the
 * deferral, then `paymentCents` a month. A payment that does not cover the
 * interest would never repay anything, so the projection stops at MAX_MONTHS.
 */
function project({ capitalCents, r, deferralMonths, paymentCents, insuranceCents, from, termMonths }: Projection): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  let remaining = capitalCents;
  for (let month = 1; remaining > 0 && month <= MAX_MONTHS; month++) {
    const interest = Math.round(remaining * r);
    const deferral = month <= deferralMonths;
    const settles = month === termMonths;
    const principal = deferral ? 0 : settles ? remaining : Math.min(remaining, Math.max(0, paymentCents - interest));
    remaining -= principal;
    rows.push({
      month,
      date: addMonthsUtc(from, month),
      phase: deferral ? "deferral" : "amortizing",
      paymentCents: interest + principal,
      interestCents: interest,
      principalCents: principal,
      insuranceCents,
      remainingCents: remaining,
    });
  }
  return rows;
}

/** Every instalment of the loan, from its start date. */
export function amortizationSchedule(params: LoanParams, insuranceMonthlyCents = 0): ScheduleRow[] {
  return project({
    capitalCents: Number(params.loanAmountCents),
    r: params.loanTaeg / 100 / 12,
    deferralMonths: params.loanDeferralMonths,
    paymentCents: Number(calcMonthlyPayments(params).amortPaymentCents),
    insuranceCents: insuranceMonthlyCents,
    from: params.loanStartDate,
    termMonths: params.loanDurationMonths,
  });
}

export type YearSummary = {
  year: number;
  paidCents: number;
  interestCents: number;
  principalCents: number;
  insuranceCents: number;
  /** Capital owed at the end of that year. */
  remainingCents: number;
  rows: ScheduleRow[];
};

/** The schedule grouped by calendar year, the way a bank's own table reads. */
export function scheduleByYear(rows: readonly ScheduleRow[]): YearSummary[] {
  const years = new Map<number, YearSummary>();
  for (const row of rows) {
    const year = row.date.getUTCFullYear();
    const summary = years.get(year) ?? { year, paidCents: 0, interestCents: 0, principalCents: 0, insuranceCents: 0, remainingCents: 0, rows: [] };
    summary.paidCents += row.paymentCents + row.insuranceCents;
    summary.interestCents += row.interestCents;
    summary.principalCents += row.principalCents;
    summary.insuranceCents += row.insuranceCents;
    summary.remainingCents = row.remainingCents;
    summary.rows.push(row);
    years.set(year, summary);
  }
  return [...years.values()];
}

export type PrepaymentMode = "shorten" | "lower_payment";

export type PrepaymentInput = {
  amountCents: number;
  mode: PrepaymentMode;
  /** Early-repayment fees the lender charges (IRA in France), if any. */
  feesCents: number;
  asOf: Date;
};

export type PrepaymentResult = {
  /** Capital owed today, before the repayment. */
  capitalBeforeCents: number;
  /** What is actually repaid - never more than is owed. */
  repaidCents: number;
  interestBeforeCents: number;
  interestAfterCents: number;
  /** Interest avoided, minus the fees. Negative when the fees outweigh it. */
  netSavingCents: number;
  monthsLeftBefore: number;
  monthsLeftAfter: number;
  paymentBeforeCents: number;
  paymentAfterCents: number;
  endDateBefore: Date | null;
  endDateAfter: Date | null;
};

const sum = (rows: readonly ScheduleRow[], pick: (r: ScheduleRow) => number) => rows.reduce((s, r) => s + pick(r), 0);

/**
 * Repaying part of the capital today: either the instalment stays and the
 * loan ends sooner ("shorten"), or the end date stays and the instalment
 * drops ("lower_payment"). A deferral still running keeps running - only
 * its interest shrinks.
 */
export function simulatePrepayment(params: LoanParams, insuranceMonthlyCents: number, input: PrepaymentInput): PrepaymentResult {
  const schedule = amortizationSchedule(params, insuranceMonthlyCents);
  const elapsed = Math.min(schedule.length, Math.max(0, monthsBetween(params.loanStartDate, input.asOf)));
  const future = schedule.slice(elapsed);
  const capitalBefore = elapsed === 0 ? Number(params.loanAmountCents) : schedule[elapsed - 1].remainingCents;
  const repaid = Math.min(Math.max(0, input.amountCents), capitalBefore);
  const r = params.loanTaeg / 100 / 12;
  const deferralLeft = future.filter((row) => row.phase === "deferral").length;
  const amortLeft = future.length - deferralLeft;
  const paymentBefore = Number(calcMonthlyPayments(params).amortPaymentCents);
  const paymentAfter = input.mode === "shorten" ? paymentBefore : annuityCents(capitalBefore - repaid, r, amortLeft);
  const after = project({
    capitalCents: capitalBefore - repaid,
    r,
    deferralMonths: deferralLeft,
    paymentCents: paymentAfter,
    insuranceCents: insuranceMonthlyCents,
    from: elapsed === 0 ? params.loanStartDate : schedule[elapsed - 1].date,
    termMonths: input.mode === "lower_payment" ? future.length : undefined,
  });
  const interestBefore = sum(future, (row) => row.interestCents);
  const interestAfter = sum(after, (row) => row.interestCents);
  return {
    capitalBeforeCents: capitalBefore,
    repaidCents: repaid,
    interestBeforeCents: interestBefore,
    interestAfterCents: interestAfter,
    netSavingCents: interestBefore - interestAfter - Math.max(0, input.feesCents),
    monthsLeftBefore: future.length,
    monthsLeftAfter: after.length,
    paymentBeforeCents: paymentBefore,
    paymentAfterCents: after.length === 0 ? 0 : paymentAfter,
    endDateBefore: future.at(-1)?.date ?? null,
    endDateAfter: after.at(-1)?.date ?? null,
  };
}
