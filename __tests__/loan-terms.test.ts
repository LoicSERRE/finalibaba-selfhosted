import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A loan's contract terms, editable (v2.19.2): what its bank never sends
 * (start, duration, deferral, insurance) or gets wrong - while what is owed
 * and the next instalment stay the bank's.
 */

const m = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { account: { findUnique: m.findUnique, update: m.update } } }));
vi.mock("@/lib/auth-context", () => ({
  getViewer: vi.fn(async () => ({ id: "user-owner" })),
  assertAccountWritable: vi.fn(async () => {}),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { parseLoanTerms, loanTermsValues } from "@/lib/domain/loan-terms";
import { looksInterestOnly } from "@/lib/domain/loan";
import { updateLoanTerms } from "@/lib/actions/loans";

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  m.findUnique.mockReset();
  m.update.mockReset().mockResolvedValue({});
});

describe("parseLoanTerms", () => {
  it("reads every term, French decimals included, and leaves blanks empty", () => {
    const parsed = parseLoanTerms({ amount: "5000", rate: "0,99", startDate: "2026-10-01", durationMonths: "72", deferralMonths: "24", insurance: "", endDate: "" });
    expect(parsed).toEqual({
      ok: true,
      terms: {
        loanAmountCents: BigInt(5000_00),
        loanTaeg: 0.99,
        loanStartDate: new Date("2026-10-01T12:00:00.000Z"),
        loanDurationMonths: 72,
        loanDeferralMonths: 24,
        insuranceMonthlyCents: null,
        loanEndDate: null,
      },
    });
  });

  it("refuses what cannot be a loan's terms", () => {
    expect(parseLoanTerms({ amount: "-5" })).toEqual({ ok: false, error: "invalid_amount" });
    expect(parseLoanTerms({ rate: "150" })).toEqual({ ok: false, error: "invalid_rate" });
    expect(parseLoanTerms({ durationMonths: "0" })).toEqual({ ok: false, error: "invalid_duration" });
    expect(parseLoanTerms({ durationMonths: "12.5" })).toEqual({ ok: false, error: "invalid_duration" });
    // A deferral is part of the duration, never all of it.
    expect(parseLoanTerms({ durationMonths: "24", deferralMonths: "24" })).toEqual({ ok: false, error: "invalid_deferral" });
    expect(parseLoanTerms({ startDate: "2030-01-01", endDate: "2029-01-01" })).toEqual({ ok: false, error: "invalid_date" });
    expect(parseLoanTerms({ startDate: "01/10/2026" })).toEqual({ ok: false, error: "invalid_date" });
  });

  it("round-trips through the dialog's pre-filled values", () => {
    const values = loanTermsValues({
      loanAmountCents: BigInt(5000_00), loanTaeg: 0.99, loanStartDate: new Date("2026-10-01T12:00:00Z"),
      loanDurationMonths: 72, loanDeferralMonths: 24, insuranceMonthlyCents: null, loanEndDate: null,
    });
    const parsed = parseLoanTerms(values);
    expect(parsed.ok && parsed.terms.loanAmountCents).toBe(BigInt(5000_00));
    expect(parsed.ok && parsed.terms.loanStartDate?.toISOString().slice(0, 10)).toBe("2026-10-01");
  });
});

describe("looksInterestOnly", () => {
  // 5 000 € at 0,99%: ~4,13 € of interest a month, ~106 € once repaying.
  it("tells a deferral's instalment from a repaying one", () => {
    expect(looksInterestOnly(BigInt(4_13), BigInt(5000_00), 0.99)).toBe(true);
    expect(looksInterestOnly(BigInt(4_90), BigInt(5000_00), 0.99)).toBe(true); // a little insurance on top
    expect(looksInterestOnly(BigInt(106_00), BigInt(5000_00), 0.99)).toBe(false);
  });

  it("refuses to guess without the figures", () => {
    expect(looksInterestOnly(null, BigInt(5000_00), 0.99)).toBeNull();
    expect(looksInterestOnly(BigInt(4_13), BigInt(5000_00), null)).toBeNull();
    expect(looksInterestOnly(BigInt(4_13), BigInt(0), 0.99)).toBeNull();
  });
});

describe("updateLoanTerms", () => {
  it("never touches what a bank-reported loan owes", async () => {
    m.findUnique.mockResolvedValue({ type: "LOAN", syncId: "woob:inst:pret1", gocardlessAccountId: null });
    const result = await updateLoanTerms("l", form({ amount: "5000", durationMonths: "72", deferralMonths: "24" }));
    expect(result).toEqual({ ok: true, data: undefined });
    const data = m.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ loanAmountCents: BigInt(5000_00), loanDurationMonths: 72, loanDeferralMonths: 24 });
    expect(data).not.toHaveProperty("liabilityCents");
  });

  it("moves a manual loan's capital with its amount borrowed", async () => {
    m.findUnique.mockResolvedValue({ type: "LOAN", syncId: null, gocardlessAccountId: null });
    await updateLoanTerms("l", form({ amount: "8000" }));
    expect(m.update.mock.calls[0][0].data.liabilityCents).toBe(BigInt(8000_00));
  });

  it("refuses an account that is not a loan, and a bad term, writing nothing", async () => {
    m.findUnique.mockResolvedValue({ type: "CHECKING", syncId: null, gocardlessAccountId: null });
    expect(await updateLoanTerms("c", form({ amount: "1" }))).toEqual({ ok: false, error: "not_a_loan" });
    m.findUnique.mockResolvedValue({ type: "LOAN", syncId: null, gocardlessAccountId: null });
    expect(await updateLoanTerms("l", form({ rate: "abc" }))).toEqual({ ok: false, error: "invalid_rate" });
    expect(m.update).not.toHaveBeenCalled();
  });
});
