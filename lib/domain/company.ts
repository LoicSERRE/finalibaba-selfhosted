import Decimal from "decimal.js";

/**
 * Companies (SCI first) - the one valuation module (dev-docs/companies.md,
 * principle 4). Pure: every consumer that shows a net worth gets a company's
 * share through here, none re-derives it.
 *
 * A company's own value is not computed here at all: it is computeDashboard
 * over the company's accounts (principle 5), so a second net-worth
 * implementation cannot drift from the first. This module only turns that
 * value into a share, and folds shares into a person's figures.
 */

// ── Cap table ──────────────────────────────────────────────────────────────

export const MAX_TOTAL_PARTS = 100_000_000;
export const MAX_ASSOCIATES = 50;
export const MAX_COMPANY_NAME_LENGTH = 120;

export interface CapTableRow {
  name: string;
  parts: number;
  /** A user of the instance this associate is linked to, if any. */
  userId?: string | null;
}

export type CapTableError =
  | "name_required"
  | "name_too_long"
  | "total_parts_invalid"
  | "no_associates"
  | "too_many_associates"
  | "parts_invalid"
  | "parts_sum_mismatch"
  | "duplicate_user";

function isPositiveInt(n: unknown, max: number): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= max;
}

export function validateCompanyName(raw: unknown): { ok: true; name: string } | { ok: false; error: CapTableError } {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) return { ok: false, error: "name_required" };
  if (name.length > MAX_COMPANY_NAME_LENGTH) return { ok: false, error: "name_too_long" };
  return { ok: true, name };
}

/**
 * The invariant the whole valuation rests on: the parts add up to the
 * statutes' total exactly, so the percentages always make 100 %. Checked on
 * every write, server-side - the arguments come from the client.
 */
export function validateCapTable(totalParts: unknown, rows: unknown): CapTableError | null {
  if (!isPositiveInt(totalParts, MAX_TOTAL_PARTS)) return "total_parts_invalid";
  if (!Array.isArray(rows) || rows.length === 0) return "no_associates";
  if (rows.length > MAX_ASSOCIATES) return "too_many_associates";

  let sum = 0;
  const users = new Set<string>();
  for (const row of rows as CapTableRow[]) {
    if (typeof row !== "object" || row === null) return "name_required";
    const named = validateCompanyName(row.name);
    if (!named.ok) return named.error;
    if (!isPositiveInt(row.parts, MAX_TOTAL_PARTS)) return "parts_invalid";
    sum += row.parts;
    if (row.userId) {
      if (users.has(row.userId)) return "duplicate_user";
      users.add(row.userId);
    }
  }
  return sum === totalParts ? null : "parts_sum_mismatch";
}

// ── Valuation ──────────────────────────────────────────────────────────────

/**
 * A holder's share of a company's value, in cents, rounded half-up once at
 * the end. Negative when the company owes more than it holds: that is the
 * economic reality of the loan the associate stands behind.
 */
export function shareCents(companyValueCents: bigint, parts: number, totalParts: number): bigint {
  if (totalParts <= 0 || parts <= 0) return BigInt(0);
  const value = new Decimal(companyValueCents.toString())
    .mul(parts)
    .div(totalParts)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return BigInt(value.toFixed(0));
}

/** One company as it counts in one person's figures. */
export interface CompanyShare {
  companyId: string;
  name: string;
  parts: number;
  totalParts: number;
  /** The company's own net value today (ANR), and the person's share of it. */
  companyValueCents: bigint;
  valueCents: bigint;
  /** The SHARE per day the company has data for, ascending by isoDate. */
  history: { isoDate: string; valueCents: number }[];
}

export function buildCompanyShare(
  company: { id: string; name: string; totalParts: number },
  parts: number,
  companyValueCents: bigint,
  companyHistory: { isoDate: string; netWorth: number }[],
): CompanyShare {
  return {
    companyId: company.id,
    name: company.name,
    parts,
    totalParts: company.totalParts,
    companyValueCents,
    valueCents: shareCents(companyValueCents, parts, company.totalParts),
    history: companyHistory.map((p) => ({
      isoDate: p.isoDate,
      valueCents: Number(shareCents(BigInt(Math.round(p.netWorth)), parts, company.totalParts)),
    })),
  };
}

/**
 * Where shares land in a person's balance sheet today. A positive share is an
 * asset (the "companies" allocation bucket), a negative one a liability, so
 * gross - liabilities stays the net worth everywhere it is computed.
 */
export function shareTotals(shares: readonly CompanyShare[]): { assetsCents: bigint; liabilitiesCents: bigint } {
  let assetsCents = BigInt(0);
  let liabilitiesCents = BigInt(0);
  for (const s of shares) {
    if (s.valueCents >= BigInt(0)) assetsCents += s.valueCents;
    else liabilitiesCents -= s.valueCents;
  }
  return { assetsCents, liabilitiesCents };
}

/**
 * Each share's value on each of `keys`, carried forward from its last known
 * point (0 before the company has any data). `keyOf` maps a share point to
 * the key space - a day for the dashboard, a month for analytics - and the
 * last point within one key wins.
 */
export function sharesOn(
  keys: readonly string[],
  shares: readonly CompanyShare[],
  keyOf: (isoDate: string) => string = (d) => d,
): { net: number; positive: number }[] {
  const out = keys.map(() => ({ net: 0, positive: 0 }));
  for (const share of shares) {
    let i = 0;
    let current = 0;
    keys.forEach((key, k) => {
      while (i < share.history.length && keyOf(share.history[i].isoDate) <= key) {
        current = share.history[i].valueCents;
        i++;
      }
      out[k].net += current;
      if (current > 0) out[k].positive += current;
    });
  }
  return out;
}

/** The sorted union of a person's own keys and every share's keys. */
export function mergedKeys(
  own: readonly string[],
  shares: readonly CompanyShare[],
  keyOf: (isoDate: string) => string = (d) => d,
): string[] {
  const all = new Set(own);
  for (const s of shares) for (const p of s.history) all.add(keyOf(p.isoDate));
  // ISO "YYYY-MM-DD" / "YYYY-MM": lexicographic order is chronological.
  return [...all].sort(); // NOSONAR
}

// ── Cap table editing (the forms) ─────────────────────────────────────────

/**
 * Where a cap table being typed stands, for the live total under the form.
 * Lenient on purpose - a half-typed row counts as 0 - while validateCapTable
 * stays the strict check the server runs on submit.
 */
export function capTableDraft(totalParts: number, parts: readonly number[]): {
  allocated: number;
  remaining: number;
  complete: boolean;
} {
  const allocated = parts.reduce((sum, p) => sum + (Number.isInteger(p) && p > 0 ? p : 0), 0);
  const total = Number.isInteger(totalParts) && totalParts > 0 ? totalParts : 0;
  return { allocated, remaining: total - allocated, complete: total > 0 && allocated === total };
}

/** A holding as a percentage of the company, one decimal, for display. */
export function partsPct(parts: number, totalParts: number): number {
  if (totalParts <= 0) return 0;
  return Math.round((parts / totalParts) * 1000) / 10;
}

// ── The dashboard's account list ──────────────────────────────────────────

/** The account type a company share carries in the dashboard's account list. */
export const COMPANY_ENTRY_TYPE = "COMPANY";

/**
 * The account list grouped by institution, plus one "companies" group with a
 * row per share - so the list adds up to the net worth above it rather than
 * leaving the shares out. The rows point at the company, not at an account.
 */
export function withCompaniesGroup<G extends { name: string | null; logoUrl: string | null; total: bigint; accounts: { id: string; name: string; value: bigint; type: string }[] }>(
  institutions: G[],
  shares: readonly CompanyShare[],
  label: string,
): (G | { name: string; logoUrl: null; total: bigint; accounts: { id: string; name: string; value: bigint; type: string }[] })[] {
  if (shares.length === 0) return institutions;
  return [
    ...institutions,
    {
      name: label,
      logoUrl: null,
      total: shares.reduce((sum, s) => sum + s.valueCents, BigInt(0)),
      accounts: shares.map((s) => ({ id: s.companyId, name: s.name, value: s.valueCents, type: COMPANY_ENTRY_TYPE })),
    },
  ];
}
