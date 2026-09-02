import type { TaxTreatment } from "@/app/generated/prisma/enums";

/**
 * Country presets: which investment wrappers and savings products exist where,
 * and what to pre-fill when one is picked.
 *
 * **What this is not.** It is not a tax engine, and adding one would be a
 * mistake rather than an improvement. Real tax rules are per-country,
 * per-wrapper, per-holding-period, and they change every year - France alone
 * has PEA, PEA-PME, CTO, assurance-vie and PER, each with its own clock. An
 * app that computes a confidently *wrong* tax figure is strictly worse than
 * one that asks. So nothing here is ever used to compute: `getAccountTaxRate`
 * remains the only resolver, and it reads the rate stored on the account,
 * which the user can always see and change.
 *
 * **What it is.** The country decides what the app *suggests* and what it
 * *calls things*. Picking "PEA" in France or "ISA" in the UK fills in a
 * treatment and a rate that the user then owns. Nothing more.
 *
 * **Why this shape.** `Account.taxTreatment` (EXEMPT / DEFERRED / TAXABLE) plus
 * `taxRatePct` was already country-agnostic and already correct: a UK ISA and a
 * US Roth IRA are both EXEMPT, a PER and a 401(k) are both DEFERRED, everything
 * else is TAXABLE at some rate. That model did not need replacing. What needed
 * replacing were the three places that bypassed it with French assumptions
 * baked into code - most damagingly a savings-interest estimator that matched
 * on account *names* ("livret a", "ldds", "lep") and therefore returned zero
 * passive income for every user outside France, silently and with no way to
 * notice. That is now `Account.interestRatePct`, a real field, in every country.
 *
 * **On the rates below.** They are starting points a user confirms, not advice,
 * and the UI says so. Several countries deliberately carry `null`: where the
 * rate depends on an income band (UK, US, Spain), on a deemed-return regime
 * (Netherlands) or on rules I will not encode second-hand (Belgium,
 * Luxembourg), suggesting a number would be inventing precision. `null` means
 * the field starts empty and the user fills it - which is the honest default
 * and, unlike a wrong suggestion, cannot quietly become a wrong net worth.
 */

export const COUNTRY_CODES = [
  "FR", "BE", "CH", "LU", "DE", "NL", "ES", "IT", "PT", "IE", "GB", "US", "CA", "OTHER",
] as const;
export type CountryCode = (typeof COUNTRY_CODES)[number];

export function isCountryCode(value: string | null | undefined): value is CountryCode {
  return !!value && (COUNTRY_CODES as readonly string[]).includes(value);
}

/** One investment wrapper offered by a country, and what picking it fills in. */
export type WrapperPreset = {
  /** Stored in Account.investmentSubtype - a label, never behaviour. */
  key: string;
  treatment: TaxTreatment;
  /** 0-1 ratio, or null when the real rate depends on the user's own bracket. */
  ratePct: number | null;
};

/**
 * A savings product whose rate is set by the state and therefore knowable -
 * but only as of a date, which is why that date is part of the type.
 *
 * A regulated rate is a fact with an expiry. France's Livret A alone moved
 * several times in the last few years and is expected to move again. A
 * suggestion carrying no date pretends to be current and is indistinguishable
 * on screen from a value the user checked themselves; a dated one announces
 * its own staleness and invites the correction. The UI shows this date next to
 * the suggested figure for exactly that reason.
 */
export type SavingsPreset = { key: string; ratePct: number; knownAt: string };

/** Displayed with every suggested savings rate - see SavingsPreset. */
export const SAVINGS_RATES_KNOWN_AT = "2026-02-01";

export type CountryPreset = {
  wrappers: WrapperPreset[];
  savings: SavingsPreset[];
  /** Fallback for a plain taxable brokerage account in this country. */
  defaultTaxablePct: number | null;
};

const TAXABLE = "TAXABLE" as TaxTreatment;
const EXEMPT = "EXEMPT" as TaxTreatment;
const DEFERRED = "DEFERRED" as TaxTreatment;

/**
 * France keeps the exact values the app used before this existed, so an
 * existing instance sees identical figures after upgrading - the migration
 * backfills from these same numbers. It is also the only country here with a
 * meaningful `savings` list: regulated products whose rate is set nationally
 * and is the same for everyone. Everywhere else, a savings rate is whatever
 * your bank offers you, so the field simply starts empty.
 */
const PRESETS: Record<CountryCode, CountryPreset> = {
  FR: {
    wrappers: [
      { key: "PEA", treatment: EXEMPT, ratePct: null },
      { key: "PEA-PME", treatment: EXEMPT, ratePct: null },
      { key: "CTO", treatment: TAXABLE, ratePct: 0.314 },
      { key: "Assurance-vie", treatment: TAXABLE, ratePct: 0.172 },
      { key: "PER", treatment: DEFERRED, ratePct: null },
    ],
    savings: [
      { key: "Livret A", ratePct: 0.015, knownAt: SAVINGS_RATES_KNOWN_AT },
      { key: "LDDS", ratePct: 0.015, knownAt: SAVINGS_RATES_KNOWN_AT },
      { key: "LEP", ratePct: 0.025, knownAt: SAVINGS_RATES_KNOWN_AT },
      { key: "Livret Jeune", ratePct: 0.025, knownAt: SAVINGS_RATES_KNOWN_AT },
    ],
    defaultTaxablePct: 0.314,
  },
  BE: {
    wrappers: [
      { key: "Compte-titres", treatment: TAXABLE, ratePct: null },
      { key: "Épargne-pension", treatment: DEFERRED, ratePct: null },
    ],
    savings: [],
    defaultTaxablePct: null,
  },
  CH: {
    // Private capital gains are not taxed; wealth is taxed instead, which this
    // app does not model. Zero is correct for the gain figure it does show.
    wrappers: [
      { key: "Dépôt-titres", treatment: TAXABLE, ratePct: 0 },
      { key: "Pilier 3a", treatment: DEFERRED, ratePct: null },
    ],
    savings: [],
    defaultTaxablePct: 0,
  },
  LU: {
    wrappers: [
      { key: "Compte-titres", treatment: TAXABLE, ratePct: null },
      { key: "Prévoyance-vieillesse", treatment: DEFERRED, ratePct: null },
    ],
    savings: [],
    defaultTaxablePct: null,
  },
  DE: {
    // Abgeltungsteuer 25% plus the 5.5% solidarity surcharge on it.
    wrappers: [
      { key: "Depot", treatment: TAXABLE, ratePct: 0.26375 },
      { key: "Rürup / Riester", treatment: DEFERRED, ratePct: null },
    ],
    savings: [],
    defaultTaxablePct: 0.26375,
  },
  NL: {
    // Box 3 taxes a deemed return on net assets, not realised gains - a
    // different model entirely, so no rate is suggested.
    wrappers: [
      { key: "Beleggingsrekening", treatment: TAXABLE, ratePct: null },
      { key: "Pensioenrekening", treatment: DEFERRED, ratePct: null },
    ],
    savings: [],
    defaultTaxablePct: null,
  },
  ES: {
    wrappers: [
      { key: "Cuenta de valores", treatment: TAXABLE, ratePct: null },
      { key: "Plan de pensiones", treatment: DEFERRED, ratePct: null },
    ],
    savings: [],
    defaultTaxablePct: null,
  },
  IT: {
    wrappers: [
      { key: "Deposito titoli", treatment: TAXABLE, ratePct: 0.26 },
      { key: "Fondo pensione", treatment: DEFERRED, ratePct: null },
    ],
    savings: [],
    defaultTaxablePct: 0.26,
  },
  PT: {
    wrappers: [
      { key: "Conta de títulos", treatment: TAXABLE, ratePct: 0.28 },
      { key: "PPR", treatment: DEFERRED, ratePct: null },
    ],
    savings: [],
    defaultTaxablePct: 0.28,
  },
  IE: {
    wrappers: [
      { key: "General investment", treatment: TAXABLE, ratePct: 0.33 },
      { key: "PRSA", treatment: DEFERRED, ratePct: null },
    ],
    savings: [],
    defaultTaxablePct: 0.33,
  },
  GB: {
    // CGT is band-dependent, so the taxable wrapper starts empty on purpose.
    wrappers: [
      { key: "ISA", treatment: EXEMPT, ratePct: null },
      { key: "SIPP", treatment: DEFERRED, ratePct: null },
      { key: "GIA", treatment: TAXABLE, ratePct: null },
    ],
    savings: [],
    defaultTaxablePct: null,
  },
  US: {
    wrappers: [
      { key: "Roth IRA", treatment: EXEMPT, ratePct: null },
      { key: "HSA", treatment: EXEMPT, ratePct: null },
      { key: "401(k)", treatment: DEFERRED, ratePct: null },
      { key: "Traditional IRA", treatment: DEFERRED, ratePct: null },
      { key: "Brokerage", treatment: TAXABLE, ratePct: null },
    ],
    savings: [],
    defaultTaxablePct: null,
  },
  CA: {
    wrappers: [
      { key: "TFSA", treatment: EXEMPT, ratePct: null },
      { key: "RRSP", treatment: DEFERRED, ratePct: null },
      { key: "Non-registered", treatment: TAXABLE, ratePct: null },
    ],
    savings: [],
    defaultTaxablePct: null,
  },
  OTHER: {
    // No assumptions at all: two neutral shapes, both rates user-entered.
    wrappers: [
      { key: "Taxable", treatment: TAXABLE, ratePct: null },
      { key: "Tax-advantaged", treatment: EXEMPT, ratePct: null },
    ],
    savings: [],
    defaultTaxablePct: null,
  },
};

/**
 * The preset pack for a country. An unset or unrecognised country resolves to
 * OTHER rather than to France - a self-hoster who has not said where they live
 * must not silently inherit French wrappers and French rates, which is exactly
 * the assumption this module exists to remove.
 */
export function countryPreset(country: string | null | undefined): CountryPreset {
  return PRESETS[isCountryCode(country) ? country : "OTHER"];
}

/** The wrapper preset for a stored `investmentSubtype`, if the country has one. */
export function wrapperPreset(country: string | null | undefined, key: string | null | undefined): WrapperPreset | null {
  if (!key) return null;
  return countryPreset(country).wrappers.find((w) => w.key === key) ?? null;
}

/**
 * The savings rate this country would suggest for an account with this name,
 * or null when it has nothing to say.
 *
 * This is the *only* place account names are still consulted, and it is now a
 * one-shot convenience at creation time rather than a permanent computation:
 * whatever it returns is written to `Account.interestRatePct`, where the user
 * can see and correct it. Previously the same matching ran on every analytics
 * render, forever, invisibly - so a rate change meant editing the source, and a
 * non-French account simply produced nothing.
 */
export function suggestedSavingsRate(country: string | null | undefined, accountName: string): number | null {
  const name = accountName.toLowerCase();
  const products = countryPreset(country).savings;
  // Longest key first, so "Livret Jeune" wins over the looser "Livret".
  const match = [...products]
    .sort((a, b) => b.key.length - a.key.length)
    .find((p) => name.includes(p.key.toLowerCase()));
  if (match) return match.ratePct;
  // France only: a generic "Livret <something>" is still a regulated product.
  if (isCountryCode(country) && country === "FR" && name.includes("livret")) return 0.015;
  return null;
}
