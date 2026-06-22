/**
 * Loan calculation utilities (account type LOAN).
 *
 * Notation:
 *  - P   : initial borrowed amount (in €)
 *  - r   : monthly rate = TAEG / 100 / 12
 *  - N   : total duration (months)
 *  - D   : deferral period (months) — interest-only payments during this period
 *  - n   : amortization duration = N - D
 */

/** Number of full months elapsed between two dates. */
function monthsBetween(start: Date, end: Date): number {
  return (
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth())
  );
}

export type LoanParams = {
  loanAmountCents: bigint;
  loanTaeg: number;           // in %, e.g. 5.47
  loanDurationMonths: number;
  loanDeferralMonths: number; // 0 = no deferral
  loanStartDate: Date;
};

/**
 * Remaining capital in cents at a given date (default: today).
 */
export function calcCurrentCapital(
  params: LoanParams,
  asOf: Date = new Date()
): bigint {
  const { loanAmountCents, loanTaeg, loanDurationMonths, loanDeferralMonths, loanStartDate } = params;
  const P = Number(loanAmountCents) / 100;
  const r = loanTaeg / 100 / 12;
  const N = loanDurationMonths;
  const D = loanDeferralMonths;
  const elapsed = monthsBetween(loanStartDate, asOf);

  if (elapsed <= 0) return loanAmountCents;
  if (elapsed >= N) return BigInt(0);

  // During deferral: capital unchanged
  if (elapsed <= D) return loanAmountCents;

  // After deferral: constant annuity over (N - D) months
  const amortMonths = N - D;
  const monthsAmortized = elapsed - D;

  let remaining: number;
  if (r === 0) {
    remaining = P * (1 - monthsAmortized / amortMonths);
  } else {
    const pmt = (P * r) / (1 - Math.pow(1 + r, -amortMonths));
    remaining =
      P * Math.pow(1 + r, monthsAmortized) -
      (pmt * (Math.pow(1 + r, monthsAmortized) - 1)) / r;
  }

  return BigInt(Math.max(0, Math.round(remaining * 100)));
}

export type MonthlyPayments = {
  /** Monthly payment during deferral (interest only, excl. insurance). */
  deferralPaymentCents: bigint;
  /** Monthly payment after deferral (principal + interest, excl. insurance). */
  amortPaymentCents: bigint;
};

export function calcMonthlyPayments(params: LoanParams): MonthlyPayments {
  const { loanAmountCents, loanTaeg, loanDurationMonths, loanDeferralMonths } = params;
  const P = Number(loanAmountCents) / 100;
  const r = loanTaeg / 100 / 12;
  const N = loanDurationMonths;
  const D = loanDeferralMonths;

  const deferralPaymentCents = BigInt(Math.round(P * r * 100));

  let amortPaymentCents: bigint;
  const amortMonths = N - D;
  if (amortMonths <= 0) {
    amortPaymentCents = BigInt(0);
  } else if (r === 0) {
    amortPaymentCents = BigInt(Math.round((P / amortMonths) * 100));
  } else {
    const pmt = (P * r) / (1 - Math.pow(1 + r, -amortMonths));
    amortPaymentCents = BigInt(Math.round(pmt * 100));
  }

  return { deferralPaymentCents, amortPaymentCents };
}

export type LoanStats = {
  currentCapitalCents: bigint;
  /** Monthly payment currently applicable (including insurance if provided). */
  currentMonthlyTotalCents: bigint;
  /** Monthly payment excl. insurance, currently applicable. */
  currentMonthlyBaseCents: bigint;
  /** Monthly payment during deferral (excl. insurance). */
  deferralPaymentCents: bigint;
  /** Monthly payment after deferral (excl. insurance). */
  amortPaymentCents: bigint;
  /** Total interest over the full loan duration (incl. deferral). */
  totalInterestCents: bigint;
  /** Total cost of the loan (interest + insurance × N). */
  totalCostCents: bigint;
  /** Theoretical end date. */
  endDate: Date;
  /** Months elapsed. */
  monthsElapsed: number;
  /** Status: "deferral" | "amortizing" | "finished". */
  status: "deferral" | "amortizing" | "finished";
  /** Overall progress (0–100). */
  progressPct: number;
};

export function calcLoanStats(
  params: LoanParams,
  insuranceMonthlyCents: bigint = BigInt(0),
  asOf: Date = new Date()
): LoanStats {
  const { loanAmountCents, loanTaeg, loanDurationMonths, loanDeferralMonths, loanStartDate } =
    params;
  const P = Number(loanAmountCents) / 100;
  const r = loanTaeg / 100 / 12;
  const N = loanDurationMonths;
  const D = loanDeferralMonths;
  const elapsed = monthsBetween(loanStartDate, asOf);

  const { deferralPaymentCents, amortPaymentCents } = calcMonthlyPayments(params);
  const currentCapitalCents = calcCurrentCapital(params, asOf);

  // Total interest = (total payments) - principal
  const amortMonths = N - D;
  const totalDeferralInterestCents = BigInt(Math.round(P * r * D * 100));
  const totalAmortPaymentsCents = amortPaymentCents * BigInt(amortMonths);
  const totalInterestCents =
    totalDeferralInterestCents + totalAmortPaymentsCents - loanAmountCents;

  const totalCostCents =
    totalInterestCents + insuranceMonthlyCents * BigInt(N);

  const endDate = new Date(loanStartDate);
  endDate.setMonth(endDate.getMonth() + N);

  let status: LoanStats["status"];
  if (elapsed >= N) status = "finished";
  else if (elapsed <= D) status = "deferral";
  else status = "amortizing";

  const progressPct = Math.min(100, Math.max(0, Math.round((elapsed / N) * 100)));

  let currentMonthlyBaseCents: bigint;
  if (status === "finished") currentMonthlyBaseCents = BigInt(0);
  else if (status === "deferral") currentMonthlyBaseCents = deferralPaymentCents;
  else currentMonthlyBaseCents = amortPaymentCents;

  const currentMonthlyTotalCents = currentMonthlyBaseCents + insuranceMonthlyCents;

  return {
    currentCapitalCents,
    currentMonthlyTotalCents,
    currentMonthlyBaseCents,
    deferralPaymentCents,
    amortPaymentCents,
    totalInterestCents,
    totalCostCents,
    endDate,
    monthsElapsed: elapsed,
    status,
    progressPct,
  };
}

/**
 * Returns true when an account has all required loan params to compute stats.
 */
export function hasLoanParams(account: {
  loanAmountCents: bigint | null;
  loanTaeg: number | null;
  loanDurationMonths: number | null;
  loanStartDate: Date | null;
}): account is {
  loanAmountCents: bigint;
  loanTaeg: number;
  loanDurationMonths: number;
  loanStartDate: Date;
  loanDeferralMonths: number | null;
} {
  return (
    account.loanAmountCents !== null &&
    account.loanTaeg !== null &&
    account.loanDurationMonths !== null &&
    account.loanStartDate !== null
  );
}
