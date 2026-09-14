/**
 * One person's own financial record, as a file they can keep.
 *
 * **Why this exists.** The only export this app had was `pg_dump` of the whole
 * database, admin-only - so an invited user could get nothing at all, and the
 * admin could get nothing WITHOUT also getting everybody else's accounts,
 * balances and transaction labels in clear. Reported exactly that way: "je veux
 * pas pouvoir exporter et voir le compte de mes potes, chacun sa sauvegarde".
 * A full dump stays for restoring an instance; this is what "my data" means.
 *
 * **The scope is what a person owns, not what they can see.** Accounts are
 * taken by `Account.userId` alone, never `baseAccountIds`: a co-owned account
 * belongs to whoever created it, and putting a joint account in both people's
 * exports would quietly hand each of them a copy of the other's record. The
 * account's owner is already the single answer to "who decides who sees this"
 * everywhere else in this codebase, so it is the answer here too.
 *
 * **Credentials are deliberately absent, and that is the load-bearing line.**
 * v2.10.6 encrypted the bank logins, the TOTP secret, the SMTP password, the
 * ntfy token and the three bearer tokens precisely so a leaked database or
 * backup yields nothing. Writing them back out in clear, into a file that goes
 * to a Downloads folder by design, would undo that in one feature. So an
 * institution exports its NAME and its module and never its login; re-entering
 * a bank password after a restore is half a minute, and it is the only part of
 * this that cannot be un-leaked.
 *
 * Sync plumbing is out for a different reason: `Account.syncId` is globally
 * unique and names a connection on one instance, so carrying it into a file
 * meant to be portable would either collide on import or silently re-point
 * somebody else's bank connection. An imported account comes back as a manual
 * one, which is honest - the connection is re-made, not restored.
 *
 * **Ids travel as opaque reference keys.** Rows keep the ids they had, and the
 * importer maps every one to a freshly generated id. Keeping them is what lets
 * a transaction name its category and an alert rule name its account without
 * inventing a second numbering scheme, and re-generating them on the way in is
 * what stops an import ever writing over a row that happens to share an id.
 */

export const USER_EXPORT_FORMAT = "finalibaba-user-export";
export const USER_EXPORT_VERSION = 1;

/**
 * Every `*Cents` field below is a decimal STRING, not a number. JSON numbers
 * are IEEE doubles and cannot hold a BigInt exactly, so a large enough balance
 * would come back off by a cent or two - silently, in a file whose whole
 * purpose is being exact.
 */

export type InstitutionExport = {
  ref: string;
  name: string;
  /** The Woob module or the Trade Republic sentinel, never the credentials. */
  provider: string | null;
};

export type CategoryExport = {
  ref: string;
  name: string;
  color: string;
  kind: string;
  budgetCents: string | null;
  budgetRolloverEnabled: boolean;
  budgetRolloverEnabledAt: string | null;
};

export type TransactionExport = {
  ref: string;
  date: string;
  label: string;
  amountCents: string;
  categoryRef: string | null;
  merchantCategoryCode: string | null;
  isInternalTransfer: boolean;
  internalTransferManual: boolean | null;
  isSecuritiesMovement: boolean;
  sourceEventType: string | null;
  splits: { amountCents: string; categoryRef: string | null }[];
};

export type HoldingExport = {
  ref: string;
  ticker: string;
  name: string | null;
  quantity: string;
  lastPriceCents: string | null;
  costBasisCents: string | null;
  targetPct: number | null;
  currency: string;
  nativePriceCents: string | null;
  nativeCostBasisCents: string | null;
  fxRateToEur: number | null;
};

export type AccountExport = {
  ref: string;
  name: string;
  type: string;
  institutionRef: string | null;
  manualValueCents: string | null;
  liabilityCents: string | null;
  purchasePriceCents: string | null;
  insuranceMonthlyCents: string | null;
  investmentSubtype: string | null;
  investmentStartDate: string | null;
  taxTreatment: string;
  taxRatePct: number | null;
  dividendsAlreadyNet: boolean;
  interestRatePct: number | null;
  loanAmountCents: string | null;
  loanTaeg: number | null;
  loanDurationMonths: number | null;
  loanDeferralMonths: number | null;
  loanStartDate: string | null;
  balances: { recordedAt: string; balanceCents: string }[];
  transactions: TransactionExport[];
  holdings: HoldingExport[];
  sales: {
    ticker: string;
    quantity: string;
    proceedsCents: string;
    costBasisCents: string;
    date: string;
  }[];
  interestRates: { ratePct: number; until: string }[];
  incomeEvents: {
    type: string;
    ticker: string | null;
    amountCents: string;
    taxWithheldCents: string | null;
    date: string;
    transactionRef: string | null;
  }[];
};

export type UserExport = {
  format: typeof USER_EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  /** For the person reading the file, never used on import. */
  user: { username: string | null; displayName: string | null };
  settings: Record<string, unknown> | null;
  institutions: InstitutionExport[];
  categories: CategoryExport[];
  accounts: AccountExport[];
  recurringTransactions: {
    accountRef: string;
    categoryRef: string | null;
    label: string;
    amountCents: string;
    frequency: string;
    intervalCount: number;
    anchorDate: string;
    active: boolean;
    autoDetected: boolean;
    amountVaries: boolean;
    dismissedAt: string | null;
  }[];
  goals: {
    name: string;
    targetCents: string;
    targetDate: string | null;
    accountRef: string | null;
  }[];
  alertRules: {
    kind: string;
    active: boolean;
    message: string | null;
    accountRef: string | null;
    holdingRef: string | null;
    categoryRef: string | null;
    balanceThresholdCents: string | null;
    gainUnit: string | null;
    gainThresholdPct: number | null;
    transactionDirection: string | null;
  }[];
};

/**
 * Every `UserSettings` column this export deliberately leaves behind.
 *
 * The first four are credentials, out for the reason in this file's header.
 * The rest are per-device or per-instance state that means nothing in another
 * database: VAPID keys identify this instance to a push service, the app-lock
 * and TOTP columns are vestigial, and the alert dedup flags are a record of
 * what was already sent rather than a setting anybody chose.
 */
export const SETTINGS_NOT_EXPORTED = [
  "smtpPassword",
  "ntfyAuthToken",
  "vapidPrivateKey",
  "vapidPublicKey",
  "totpSecret",
  "totpEnabled",
  "totpBackupCodes",
  "appLockEnabled",
  "appLockChallenge",
  "netWorthAlertLastAbove",
  "id",
  "userId",
  "createdAt",
  "updatedAt",
] as const;

/**
 * Every `Account` column deliberately left behind, so the completeness test
 * can tell "considered and excluded" from "forgotten".
 */
export const ACCOUNT_NOT_EXPORTED = [
  "id",
  "userId",
  "institutionId",
  "createdAt",
  "updatedAt",
  // Instance-local sync plumbing, see the header.
  "syncId",
  "gocardlessAccountId",
  "holdingsReportedAt",
  "holdingsStaleSince",
  // A record of a notification already sent, not a setting.
  "loanPaidOffAlertSent",
] as const;

const cents = (v: bigint | null | undefined): string | null =>
  v === null || v === undefined ? null : v.toString();

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** Narrow structural shapes, so this module needs no Prisma types. */
type Row = Record<string, unknown>;

function pickSettings(settings: Row | null): Record<string, unknown> | null {
  if (!settings) return null;
  const excluded = new Set<string>(SETTINGS_NOT_EXPORTED);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (excluded.has(key)) continue;
    out[key] = typeof value === "bigint" ? value.toString() : value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

export type UserExportInput = {
  user: { username: string | null; displayName: string | null };
  settings: Row | null;
  institutions: Row[];
  categories: Row[];
  accounts: Row[];
  recurringTransactions: Row[];
  goals: Row[];
  alertRules: Row[];
  exportedAt?: Date;
};

/**
 * Turns already-fetched rows into the file. No I/O, per this folder's rule,
 * which is also what lets the completeness test run it against fixtures.
 */
export function buildUserExport(input: UserExportInput): UserExport {
  const accounts: AccountExport[] = input.accounts.map((a) => {
    const holdings = ((a.holdings as Row[]) ?? []).map((h) => ({
      ref: h.id as string,
      ticker: h.ticker as string,
      name: (h.name as string) ?? null,
      quantity: String(h.quantity),
      lastPriceCents: cents(h.lastPriceCents as bigint),
      costBasisCents: cents(h.costBasisCents as bigint),
      targetPct: (h.targetPct as number) ?? null,
      currency: (h.currency as string) ?? "EUR",
      nativePriceCents: cents(h.nativePriceCents as bigint),
      nativeCostBasisCents: cents(h.nativeCostBasisCents as bigint),
      fxRateToEur: (h.fxRateToEur as number) ?? null,
    }));

    return {
      ref: a.id as string,
      name: a.name as string,
      type: a.type as string,
      institutionRef: (a.institutionId as string) ?? null,
      manualValueCents: cents(a.manualValueCents as bigint),
      liabilityCents: cents(a.liabilityCents as bigint),
      purchasePriceCents: cents(a.purchasePriceCents as bigint),
      insuranceMonthlyCents: cents(a.insuranceMonthlyCents as bigint),
      investmentSubtype: (a.investmentSubtype as string) ?? null,
      investmentStartDate: iso(a.investmentStartDate as Date),
      taxTreatment: a.taxTreatment as string,
      taxRatePct: (a.taxRatePct as number) ?? null,
      dividendsAlreadyNet: Boolean(a.dividendsAlreadyNet),
      interestRatePct: (a.interestRatePct as number) ?? null,
      loanAmountCents: cents(a.loanAmountCents as bigint),
      loanTaeg: (a.loanTaeg as number) ?? null,
      loanDurationMonths: (a.loanDurationMonths as number) ?? null,
      loanDeferralMonths: (a.loanDeferralMonths as number) ?? null,
      loanStartDate: iso(a.loanStartDate as Date),
      balances: ((a.history as Row[]) ?? []).map((b) => ({
        recordedAt: iso(b.recordedAt as Date)!,
        balanceCents: cents(b.balanceCents as bigint)!,
      })),
      transactions: ((a.transactions as Row[]) ?? []).map((t) => ({
        ref: t.id as string,
        date: iso(t.date as Date)!,
        label: t.label as string,
        amountCents: cents(t.amountCents as bigint)!,
        categoryRef: (t.categoryId as string) ?? null,
        merchantCategoryCode: (t.merchantCategoryCode as string) ?? null,
        isInternalTransfer: Boolean(t.isInternalTransfer),
        internalTransferManual: (t.internalTransferManual as boolean) ?? null,
        isSecuritiesMovement: Boolean(t.isSecuritiesMovement),
        sourceEventType: (t.sourceEventType as string) ?? null,
        splits: ((t.splits as Row[]) ?? []).map((s) => ({
          amountCents: cents(s.amountCents as bigint)!,
          categoryRef: (s.categoryId as string) ?? null,
        })),
      })),
      holdings,
      sales: ((a.sales as Row[]) ?? []).map((s) => ({
        ticker: s.ticker as string,
        quantity: String(s.quantity),
        proceedsCents: cents(s.proceedsCents as bigint)!,
        costBasisCents: cents(s.costBasisCents as bigint)!,
        date: iso(s.date as Date)!,
      })),
      interestRates: ((a.interestRateHistory as Row[]) ?? []).map((r) => ({
        ratePct: r.ratePct as number,
        until: iso(r.until as Date)!,
      })),
      incomeEvents: ((a.incomeEvents as Row[]) ?? []).map((e) => ({
        type: e.type as string,
        ticker: (e.ticker as string) ?? null,
        amountCents: cents(e.amountCents as bigint)!,
        taxWithheldCents: cents(e.taxWithheldCents as bigint),
        date: iso(e.date as Date)!,
        transactionRef: (e.transactionId as string) ?? null,
      })),
    };
  });

  return {
    format: USER_EXPORT_FORMAT,
    version: USER_EXPORT_VERSION,
    exportedAt: (input.exportedAt ?? new Date()).toISOString(),
    user: input.user,
    settings: pickSettings(input.settings),
    institutions: input.institutions.map((i) => ({
      ref: i.id as string,
      name: i.name as string,
      provider: (i.woobModule as string) ?? null,
    })),
    categories: input.categories.map((c) => ({
      ref: c.id as string,
      name: c.name as string,
      color: c.color as string,
      kind: c.kind as string,
      budgetCents: cents(c.budgetCents as bigint),
      budgetRolloverEnabled: Boolean(c.budgetRolloverEnabled),
      budgetRolloverEnabledAt: iso(c.budgetRolloverEnabledAt as Date),
    })),
    accounts,
    recurringTransactions: input.recurringTransactions.map((r) => ({
      accountRef: r.accountId as string,
      categoryRef: (r.categoryId as string) ?? null,
      label: r.label as string,
      amountCents: cents(r.amountCents as bigint)!,
      frequency: r.frequency as string,
      intervalCount: r.intervalCount as number,
      anchorDate: iso(r.anchorDate as Date)!,
      active: Boolean(r.active),
      autoDetected: Boolean(r.autoDetected),
      amountVaries: Boolean(r.amountVaries),
      dismissedAt: iso(r.dismissedAt as Date),
    })),
    goals: input.goals.map((g) => ({
      name: g.name as string,
      targetCents: cents(g.targetCents as bigint)!,
      targetDate: iso(g.targetDate as Date),
      accountRef: (g.accountId as string) ?? null,
    })),
    alertRules: input.alertRules.map((r) => ({
      kind: r.kind as string,
      active: Boolean(r.active),
      message: (r.message as string) ?? null,
      accountRef: (r.accountId as string) ?? null,
      holdingRef: (r.holdingId as string) ?? null,
      categoryRef: (r.categoryId as string) ?? null,
      balanceThresholdCents: cents(r.balanceThresholdCents as bigint),
      gainUnit: (r.gainUnit as string) ?? null,
      gainThresholdPct: (r.gainThresholdPct as number) ?? null,
      transactionDirection: (r.transactionDirection as string) ?? null,
    })),
  };
}

/** What a malformed file gets told, as a key the UI translates. */
export type ExportParseFailure =
  | "not_json"
  | "wrong_format"
  | "unsupported_version"
  | "missing_sections";

/**
 * Reads a file back, refusing anything it does not recognise.
 *
 * Strict on purpose: importing replaces the caller's own data, so a file that
 * is merely *shaped* like an export must not be half-applied. A future version
 * number is refused rather than best-effort read - an older app silently
 * dropping fields it does not know is how a restore quietly loses data.
 */
export function parseUserExport(text: string): { ok: true; data: UserExport } | { ok: false; error: ExportParseFailure } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "not_json" };
  }
  if (!raw || typeof raw !== "object") return { ok: false, error: "not_json" };
  const candidate = raw as Partial<UserExport>;
  if (candidate.format !== USER_EXPORT_FORMAT) return { ok: false, error: "wrong_format" };
  if (typeof candidate.version !== "number" || candidate.version > USER_EXPORT_VERSION) {
    return { ok: false, error: "unsupported_version" };
  }
  const sections: (keyof UserExport)[] = [
    "institutions",
    "categories",
    "accounts",
    "recurringTransactions",
    "goals",
    "alertRules",
  ];
  if (sections.some((s) => !Array.isArray(candidate[s]))) {
    return { ok: false, error: "missing_sections" };
  }
  return { ok: true, data: candidate as UserExport };
}

/** What an import is about to do, for a confirmation the user can read. */
export type ImportSummary = {
  institutions: number;
  accounts: number;
  transactions: number;
  holdings: number;
  categories: number;
};

export function summariseImport(data: UserExport): ImportSummary {
  return {
    institutions: data.institutions.length,
    accounts: data.accounts.length,
    transactions: data.accounts.reduce((n, a) => n + a.transactions.length, 0),
    holdings: data.accounts.reduce((n, a) => n + a.holdings.length, 0),
    categories: data.categories.length,
  };
}
