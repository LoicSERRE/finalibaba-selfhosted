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
/** 10 billion in the base currency - far above any real current account, far below an overflow. */
export const MAX_CURRENT_ACCOUNT_CENTS = 1_000_000_000_000;

export interface CapTableRow {
  name: string;
  /** Parts held in full ownership - 0 for someone who only holds through a
   *  démembrement block below. */
  parts: number;
  /** "YYYY-MM-DD"; required of an usufructuary, whose usufruct follows age. */
  birthDate?: string | null;
  /** A user of the instance this associate is linked to, if any. */
  userId?: string | null;
  /** Their compte courant d'associé, in cents; absent means 0. */
  currentAccountCents?: number;
}

export type CapTableError =
  | "name_required"
  | "name_too_long"
  | "total_parts_invalid"
  | "no_associates"
  | "too_many_associates"
  | "parts_invalid"
  | "parts_sum_mismatch"
  | "duplicate_user"
  | "current_account_invalid"
  | "birth_date_invalid"
  | "birth_date_required"
  | "dismemberment_invalid"
  | "associate_without_parts";

/**
 * A démembrement block in a cap table being saved: `parts` split between an
 * usufructuary and a bare owner, both given as their index in the rows.
 */
export interface DismembermentRow {
  parts: number;
  usufructuary: number;
  bareOwner: number;
}

export const MAX_DISMEMBERMENTS = 100;

function isPositiveInt(n: unknown, max: number): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= max;
}

/** A current account is a whole number of cents, never negative: absent is 0. */
function isCurrentAccount(value: unknown): boolean {
  if (value === undefined) return true;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_CURRENT_ACCOUNT_CENTS;
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
function isPartCount(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= MAX_TOTAL_PARTS;
}

/** A birth date as the forms send it: "YYYY-MM-DD", a real day, 1900 to 2100. */
export function parseBirthDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  const year = d.getUTCFullYear();
  return year >= 1900 && year <= 2100 ? d : null;
}

function validateRows(rows: CapTableRow[]): CapTableError | null {
  const users = new Set<string>();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) return "name_required";
    const named = validateCompanyName(row.name);
    if (!named.ok) return named.error;
    if (!isPartCount(row.parts)) return "parts_invalid";
    if (!isCurrentAccount(row.currentAccountCents)) return "current_account_invalid";
    if (row.birthDate !== undefined && row.birthDate !== null && row.birthDate !== "" && !parseBirthDate(row.birthDate)) {
      return "birth_date_invalid";
    }
    if (row.userId) {
      if (users.has(row.userId)) return "duplicate_user";
      users.add(row.userId);
    }
  }
  return null;
}

function validateDismemberments(rows: CapTableRow[], blocks: unknown[]): CapTableError | null {
  const isIndex = (i: unknown): i is number => typeof i === "number" && Number.isInteger(i) && i >= 0 && i < rows.length;
  for (const item of blocks) {
    const b = item as DismembermentRow;
    if (typeof b !== "object" || b === null || !isPositiveInt(b.parts, MAX_TOTAL_PARTS)) return "dismemberment_invalid";
    if (!isIndex(b.usufructuary) || !isIndex(b.bareOwner) || b.usufructuary === b.bareOwner) return "dismemberment_invalid";
    // The usufruct's value follows the usufructuary's age: no age, no value.
    if (!parseBirthDate(rows[b.usufructuary].birthDate)) return "birth_date_required";
  }
  return null;
}

/**
 * The invariant the whole valuation rests on: the parts - held outright, plus
 * every démembrement block - add up to the statutes' total exactly, so the
 * percentages always make 100 %. Checked on every write, server-side: the
 * arguments come from the client. Every associate holds something, and an
 * usufructuary has a birth date.
 */
export function validateCapTable(totalParts: unknown, rows: unknown, dismemberments: unknown = []): CapTableError | null {
  if (!isPositiveInt(totalParts, MAX_TOTAL_PARTS)) return "total_parts_invalid";
  if (!Array.isArray(rows) || rows.length === 0) return "no_associates";
  if (rows.length > MAX_ASSOCIATES) return "too_many_associates";
  if (!Array.isArray(dismemberments) || dismemberments.length > MAX_DISMEMBERMENTS) return "dismemberment_invalid";
  const typed = rows as CapTableRow[];

  const rowError = validateRows(typed) ?? validateDismemberments(typed, dismemberments);
  if (rowError) return rowError;

  const blocks = dismemberments as DismembermentRow[];
  const holds = new Set(blocks.flatMap((b) => [b.usufructuary, b.bareOwner]));
  if (typed.some((r, i) => r.parts === 0 && !holds.has(i))) return "associate_without_parts";

  const sum = typed.reduce((s, r) => s + r.parts, 0) + blocks.reduce((s, b) => s + b.parts, 0);
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

/**
 * The company's net asset value (ANR): what its own accounts are worth net of
 * its loans - computeDashboard over them - minus what it owes its associates
 * on their current accounts. The money an associate lent is already on the
 * company's bank account; the current account is the debt that matches it.
 */
export function netAssetValueCents(companyNetWorthCents: bigint, totalCurrentAccountsCents: bigint): bigint {
  return companyNetWorthCents - totalCurrentAccountsCents;
}

/** One company as it counts in one person's figures. */
export interface CompanyShare {
  companyId: string;
  name: string;
  parts: number;
  totalParts: number;
  /** The company's net asset value today (ANR, current accounts deducted). */
  companyValueCents: bigint;
  /** The person's current account in it: a receivable, part of valueCents. */
  currentAccountCents: bigint;
  /** What the company is worth to the person: their share of the ANR plus
   *  their current account. */
  valueCents: bigint;
  /** valueCents per day the company has data for, ascending by isoDate. */
  history: { isoDate: string; valueCents: number }[];
}

// ── Démembrement (step 3) ──────────────────────────────────────────────────

/** Full years between a birth date and `at`, by UTC calendar day. */
export function ageAt(birthDate: Date, at: Date): number {
  let age = at.getUTCFullYear() - birthDate.getUTCFullYear();
  const beforeBirthday =
    at.getUTCMonth() < birthDate.getUTCMonth() ||
    (at.getUTCMonth() === birthDate.getUTCMonth() && at.getUTCDate() < birthDate.getUTCDate());
  if (beforeBirthday) age -= 1;
  return Math.max(0, age);
}

/** Art. 669 I CGI: the usufruct's share of full ownership, by the usufructuary's age. */
const USUFRUCT_SCALE: readonly [maxAgeExclusive: number, pct: number][] = [
  [21, 0.9],
  [31, 0.8],
  [41, 0.7],
  [51, 0.6],
  [61, 0.5],
  [71, 0.4],
  [81, 0.3],
  [91, 0.2],
];

export function usufructPct(age: number): number {
  return USUFRUCT_SCALE.find(([limit]) => age < limit)?.[1] ?? 0.1;
}

/**
 * What one person holds in a company. Usufruct and bare ownership carry the
 * birth date their value depends on: the person's own for an usufruct, the
 * usufructuary's for a bare ownership.
 */
export interface Stake {
  fullParts: number;
  usufructs: { parts: number; birthDate: Date | null }[];
  bareOwnerships: { parts: number; usufructuaryBirthDate: Date | null }[];
}

export function fullStake(parts: number): Stake {
  return { fullParts: parts, usufructs: [], bareOwnerships: [] };
}

/** A stored block, as the stake below reads it. */
export interface HoldingRow {
  parts: number;
  fullOwnerId: string | null;
  usufructuaryId: string | null;
  bareOwnerId: string | null;
}

/** One associate's stake, from the company's blocks and its associates' birth dates. */
export function stakeOfAssociate(
  associateId: string,
  holdings: readonly HoldingRow[],
  birthDates: ReadonlyMap<string, Date | null>,
): Stake {
  const stake: Stake = { fullParts: 0, usufructs: [], bareOwnerships: [] };
  for (const h of holdings) {
    if (h.fullOwnerId === associateId) stake.fullParts += h.parts;
    if (h.usufructuaryId === associateId) stake.usufructs.push({ parts: h.parts, birthDate: birthDates.get(associateId) ?? null });
    if (h.bareOwnerId === associateId && h.usufructuaryId) {
      stake.bareOwnerships.push({ parts: h.parts, usufructuaryBirthDate: birthDates.get(h.usufructuaryId) ?? null });
    }
  }
  return stake;
}

/** Every part the person has a right on, whatever the right. */
export function partsInStake(stake: Stake): number {
  return (
    stake.fullParts +
    stake.usufructs.reduce((s, u) => s + u.parts, 0) +
    stake.bareOwnerships.reduce((s, b) => s + b.parts, 0)
  );
}

// An usufructuary without a recorded birth date (only possible for data
// written before step 3 required one) is valued at the scale's middle.
const UNKNOWN_AGE_USUFRUCT = 0.5;

function usufructPctOf(birthDate: Date | null, at: Date): number {
  return birthDate ? usufructPct(ageAt(birthDate, at)) : UNKNOWN_AGE_USUFRUCT;
}

/**
 * The stake as an equivalent number of fully owned parts on `at`: an
 * usufruct counts for its scale percentage, a bare ownership for the rest.
 * The two halves of one block always add up to the whole block.
 */
export function weightedParts(stake: Stake, at: Date): Decimal {
  let weighted = new Decimal(stake.fullParts);
  for (const u of stake.usufructs) weighted = weighted.plus(new Decimal(u.parts).mul(usufructPctOf(u.birthDate, at)));
  for (const b of stake.bareOwnerships) {
    weighted = weighted.plus(new Decimal(b.parts).mul(1 - usufructPctOf(b.usufructuaryBirthDate, at)));
  }
  return weighted;
}

/**
 * The stake's value on `at`: the net asset value, less the illiquidity
 * discount, times the weighted parts over the total - rounded half-up once.
 */
export function stakeValueCents(anrCents: bigint, stake: Stake, totalParts: number, discountPct: number | null, at: Date): bigint {
  if (totalParts <= 0) return BigInt(0);
  const value = new Decimal(anrCents.toString())
    .mul(1 - (discountPct ?? 0))
    .mul(weightedParts(stake, at))
    .div(totalParts)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return BigInt(value.toFixed(0));
}

/** A company's current accounts: all of them, and the person's own. */
export interface CurrentAccounts {
  totalCents: bigint;
  ownCents: bigint;
}

const NO_CURRENT_ACCOUNTS: CurrentAccounts = { totalCents: BigInt(0), ownCents: BigInt(0) };

/**
 * The person's figures for one company: their stake of the net asset value,
 * after the discount, plus their current account (never discounted - it is a
 * receivable). Current accounts and holdings are today's on every past day
 * until step 5 dates them; the usufruct scale uses the age on each day.
 */
export function buildCompanyShare(
  company: { id: string; name: string; totalParts: number; discountPct?: number | null },
  held: number | Stake,
  companyNetWorthCents: bigint,
  companyHistory: { isoDate: string; netWorth: number }[],
  currentAccounts: CurrentAccounts = NO_CURRENT_ACCOUNTS,
  asOf?: Date,
): CompanyShare {
  const stake = typeof held === "number" ? fullStake(held) : held;
  // Today's value of an usufruct depends on today's age: the caller says
  // which day "today" is, rather than this reading a clock.
  const hasBlocks = stake.usufructs.length + stake.bareOwnerships.length > 0;
  if (hasBlocks && !asOf) throw new Error("buildCompanyShare needs asOf for a stake with démembrement blocks.");
  const today = asOf ?? new Date(0);
  const discount = company.discountPct ?? null;
  const valueOf = (netWorth: bigint, at: Date) =>
    stakeValueCents(netAssetValueCents(netWorth, currentAccounts.totalCents), stake, company.totalParts, discount, at) +
    currentAccounts.ownCents;
  return {
    companyId: company.id,
    name: company.name,
    parts: partsInStake(stake),
    totalParts: company.totalParts,
    companyValueCents: netAssetValueCents(companyNetWorthCents, currentAccounts.totalCents),
    currentAccountCents: currentAccounts.ownCents,
    valueCents: valueOf(companyNetWorthCents, today),
    history: companyHistory.map((p) => ({
      isoDate: p.isoDate,
      valueCents: Number(valueOf(BigInt(Math.round(p.netWorth)), new Date(`${p.isoDate}T12:00:00.000Z`))),
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
export interface AccountGroup {
  name: string | null;
  logoUrl: string | null;
  total: bigint;
  accounts: { id: string; name: string; value: bigint; type: string }[];
}

export function withCompaniesGroup(institutions: AccountGroup[], shares: readonly CompanyShare[], label: string): AccountGroup[] {
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
