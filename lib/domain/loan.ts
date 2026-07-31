/**
 * Utilitaires de calcul pour les crédits (type LOAN).
 *
 * Terminologie :
 *  - P   : capital emprunté initial (en €)
 *  - r   : taux mensuel = TAEG / 100 / 12
 *  - N   : durée totale (mois)
 *  - D   : différé total (mois) - pendant lesquels on paie uniquement les intérêts
 *  - n   : durée d'amortissement = N - D
 */

/** Nombre de mois entiers écoulés entre deux dates. */
function monthsBetween(start: Date, end: Date): number {
  return (
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth())
  );
}

export type LoanParams = {
  loanAmountCents: bigint;
  loanTaeg: number;           // en % ex: 5.47
  loanDurationMonths: number;
  loanDeferralMonths: number; // 0 = pas de différé
  loanStartDate: Date;
};

/**
 * Capital restant dû en cents à une date donnée (défaut : aujourd'hui).
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

  // Pendant le différé : capital inchangé
  if (elapsed <= D) return loanAmountCents;

  // Après le différé : annuité constante sur (N - D) mois
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
  /** Mensualité pendant le différé (intérêts seuls, hors assurance). */
  deferralPaymentCents: bigint;
  /** Mensualité après différé (capital + intérêts, hors assurance). */
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
  /** Mensualité actuellement applicable (avec assurance si fournie). */
  currentMonthlyTotalCents: bigint;
  /** Mensualité hors assurance actuellement applicable. */
  currentMonthlyBaseCents: bigint;
  /** Mensualité en différé (hors assurance). */
  deferralPaymentCents: bigint;
  /** Mensualité après différé (hors assurance). */
  amortPaymentCents: bigint;
  /** Intérêts totaux sur toute la durée (y compris différé). */
  totalInterestCents: bigint;
  /** Coût total du crédit (intérêts + assurance × N). */
  totalCostCents: bigint;
  /** Date de fin théorique. */
  endDate: Date;
  /** Mois écoulés. */
  monthsElapsed: number;
  /** Statut : "deferral" | "amortizing" | "finished". */
  status: "deferral" | "amortizing" | "finished";
  /** Progression globale (0–100). */
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

  // Intérêts totaux = (paiements totaux) - capital
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
 * Vérifie qu'un compte a tous les paramètres requis pour calculer les stats.
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
