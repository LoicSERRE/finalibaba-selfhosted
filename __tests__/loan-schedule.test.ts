import { describe, expect, it } from "vitest";
import { amortizationSchedule, annuityCents, scheduleByYear, simulatePrepayment } from "@/lib/domain/loan-schedule";
import { calcLoanStats, calcMonthlyPayments, type LoanParams } from "@/lib/domain/loan";

/** v2.20: a loan's schedule, and what an early repayment would change. */

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d, 12));
// The textbook case: 100 000 € at 3% over 20 years is 554,60 € a month.
const mortgage: LoanParams = { loanAmountCents: BigInt(100_000_00), loanTaeg: 3, loanDurationMonths: 240, loanDeferralMonths: 0, loanStartDate: utc(2025, 0, 1) };
// The user's student loan: 5 000 € at 0,99%, 24 months deferred then 48 repaying.
const student: LoanParams = { loanAmountCents: BigInt(5_000_00), loanTaeg: 0.99, loanDurationMonths: 72, loanDeferralMonths: 24, loanStartDate: utc(2026, 9, 1) };

describe("amortizationSchedule", () => {
  it("repays exactly the capital, at the instalment the loan page shows", () => {
    const rows = amortizationSchedule(mortgage);
    expect(rows).toHaveLength(240);
    expect(rows[0].paymentCents).toBe(554_60);
    expect(rows[0].interestCents).toBe(250_00);
    expect(rows.reduce((s, r) => s + r.principalCents, 0)).toBe(100_000_00);
    expect(rows.at(-1)!.remainingCents).toBe(0);
    // Within a few cents of the closed-form total the loan page shows.
    const total = rows.reduce((s, r) => s + r.interestCents, 0);
    expect(Math.abs(total - Number(calcLoanStats(mortgage).totalInterestCents))).toBeLessThan(100);
  });

  it("pays interest alone during a deferral, then amortises", () => {
    const rows = amortizationSchedule(student, 8);
    expect(rows).toHaveLength(72);
    expect(rows.slice(0, 24).every((r) => r.phase === "deferral" && r.principalCents === 0 && r.remainingCents === 5_000_00)).toBe(true);
    // 412,4999... cents: the 4,12 € the loan page shows during the deferral.
    expect(rows[0].interestCents).toBe(4_12);
    expect(rows[24].phase).toBe("amortizing");
    expect(rows[24].paymentCents).toBe(Number(calcMonthlyPayments(student).amortPaymentCents));
    expect(rows[0].insuranceCents).toBe(8);
    expect(rows.at(-1)!.date).toEqual(utc(2032, 9, 1));
  });

  it("handles a zero rate", () => {
    const rows = amortizationSchedule({ ...mortgage, loanTaeg: 0, loanDurationMonths: 12, loanAmountCents: BigInt(1_200_00) });
    expect(rows.map((r) => r.paymentCents)).toEqual(Array(12).fill(100_00));
  });

  it("groups by calendar year with the capital owed at each year's end", () => {
    const years = scheduleByYear(amortizationSchedule(student));
    expect(years[0].year).toBe(2026);
    expect(years[0].rows).toHaveLength(2); // Nov and Dec: the first instalment falls a month after the start
    expect(years.at(-1)!.remainingCents).toBe(0);
    expect(years.reduce((s, y) => s + y.principalCents, 0)).toBe(5_000_00);
  });
});

describe("simulatePrepayment", () => {
  const asOf = utc(2030, 0, 15); // 60 instalments into the mortgage

  it("shortening keeps the instalment and saves the most interest", () => {
    const shorten = simulatePrepayment(mortgage, 0, { amountCents: 20_000_00, mode: "shorten", feesCents: 0, asOf });
    const lower = simulatePrepayment(mortgage, 0, { amountCents: 20_000_00, mode: "lower_payment", feesCents: 0, asOf });
    expect(shorten.monthsLeftBefore).toBe(180);
    expect(shorten.paymentAfterCents).toBe(shorten.paymentBeforeCents);
    expect(shorten.monthsLeftAfter).toBeLessThan(180);
    expect(lower.monthsLeftAfter).toBe(180);
    expect(lower.paymentAfterCents).toBeLessThan(lower.paymentBeforeCents);
    // The same 20 000 € repaid: what it saves is the interest it no longer bears.
    expect(lower.paymentAfterCents).toBe(annuityCents(lower.capitalBeforeCents - 20_000_00, 0.0025, 180));
    expect(shorten.netSavingCents).toBeGreaterThan(lower.netSavingCents);
    expect(lower.netSavingCents).toBeGreaterThan(0);
  });

  it("takes the lender's fees off the saving", () => {
    const free = simulatePrepayment(mortgage, 0, { amountCents: 20_000_00, mode: "shorten", feesCents: 0, asOf });
    const charged = simulatePrepayment(mortgage, 0, { amountCents: 20_000_00, mode: "shorten", feesCents: 600_00, asOf });
    expect(free.netSavingCents - charged.netSavingCents).toBe(600_00);
  });

  it("repays at most what is owed, and then nothing is left", () => {
    const all = simulatePrepayment(mortgage, 0, { amountCents: 1_000_000_00, mode: "shorten", feesCents: 0, asOf });
    expect(all.repaidCents).toBe(all.capitalBeforeCents);
    expect(all.monthsLeftAfter).toBe(0);
    expect(all.interestAfterCents).toBe(0);
    expect(all.endDateAfter).toBeNull();
  });

  it("keeps a running deferral, with less interest during it", () => {
    const result = simulatePrepayment(student, 0, { amountCents: 2_000_00, mode: "lower_payment", feesCents: 0, asOf: utc(2027, 0, 15) });
    expect(result.capitalBeforeCents).toBe(5_000_00);
    expect(result.monthsLeftAfter).toBe(result.monthsLeftBefore);
    // 3 000 € over the same 48 amortising months: ~63,7 € instead of ~106,3 €.
    expect(result.paymentAfterCents).toBe(annuityCents(3_000_00, 0.0099 / 12, 48));
    expect(result.paymentAfterCents).toBeLessThan(65_00);
  });
});
