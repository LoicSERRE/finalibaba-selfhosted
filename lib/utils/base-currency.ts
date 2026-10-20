/**
 * The instance's base currency (v2.19, dev-docs/currencies.md step 2): the
 * unit every *Cents column is in. Per instance, never per user - a co-owned
 * account has one stored base value - and settled once, at the first boot
 * (lib/services/instance-config.ts, from instrumentation.ts), after which
 * the stored value wins over BASE_CURRENCY so a changed variable can never
 * silently relabel existing figures.
 *
 * Read synchronously everywhere a figure is formatted: on the server from
 * the environment (which instrumentation set from the stored value), in the
 * browser from <html data-base-currency>, which the root layout renders from
 * that same value - so a server render and its hydration always agree, and
 * no NEXT_PUBLIC_ variable has to be baked into the prebuilt image.
 */

/** The bases a holding can be converted into: HoldingCurrency's values. */
export const SUPPORTED_BASE_CURRENCIES = ["EUR", "USD", "GBP", "CHF"] as const;
export type BaseCurrency = (typeof SUPPORTED_BASE_CURRENCIES)[number];

export const DEFAULT_BASE_CURRENCY: BaseCurrency = "EUR";

/** The <html> attribute the browser reads the base from. */
export const BASE_CURRENCY_ATTRIBUTE = "data-base-currency";

export function parseBaseCurrency(raw: unknown): BaseCurrency {
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return (SUPPORTED_BASE_CURRENCIES as readonly string[]).includes(code) ? (code as BaseCurrency) : DEFAULT_BASE_CURRENCY;
}

let browserBase: BaseCurrency | null = null;

export function baseCurrency(): BaseCurrency {
  if (typeof document === "undefined") return parseBaseCurrency(process.env.BASE_CURRENCY);
  browserBase ??= parseBaseCurrency(document.documentElement.getAttribute(BASE_CURRENCY_ATTRIBUTE));
  return browserBase;
}

/** The symbol formatCurrency prints for a currency ("€", "$US", "£GB", "CHF"), for unit labels. */
export function currencySymbol(code: string): string {
  const parts = new Intl.NumberFormat("fr-FR", { style: "currency", currency: code }).formatToParts(0);
  return parts.find((part) => part.type === "currency")?.value ?? code;
}

/**
 * The base an instance settles on at its first boot under v2.19: what
 * BASE_CURRENCY asks for on a fresh install, but EUR whenever data already
 * exists - every figure stored before v2.19 is EUR, and adopting another
 * base over it would relabel those figures rather than convert them.
 */
export function initialBaseCurrency(requested: unknown, hasData: boolean): BaseCurrency {
  return hasData ? DEFAULT_BASE_CURRENCY : parseBaseCurrency(requested);
}

/** The base currency's own symbol, for text that writes "1 234 €" by hand (alert messages). */
export function baseSymbol(): string {
  return currencySymbol(baseCurrency());
}
