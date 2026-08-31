// next-intl locale ("en" | "fr") -> Intl.DateTimeFormat/toLocaleDateString locale tag.
// Used for date formatting only - formatCurrency/formatPercent below stay on
// fr-FR regardless of UI locale (amounts are always EUR-denominated here, and
// making that locale-aware is a separate, much larger change).
export function localeToIntl(locale: string): string {
  return locale === "en" ? "en-US" : "fr-FR";
}

/**
 * A short date, in the locale the UI is actually running in.
 *
 * Exists because `date.toLocaleDateString()` with no argument is a hydration
 * bug waiting to happen, and was one: it resolves the locale from the runtime,
 * which is `en-US` in the Node container and the user's own in the browser. A
 * client component server-rendered with it emits "8/31/2026" and re-renders as
 * "31/08/2026", and React throws a text-mismatch hydration error (#418) on
 * every load. Reported from a real instance on the Settings page, which was
 * showing eleven such dates.
 *
 * Pass `localeToIntl(useLocale())`. That locale comes from
 * NextIntlClientProvider, so it is identical on both sides by construction.
 */
export function formatDateShort(date: Date, intlLocale: string): string {
  return new Intl.DateTimeFormat(intlLocale).format(date);
}

export function formatCurrency(cents: number | bigint, decimals = 2): string {
  const amount = typeof cents === "bigint" ? Number(cents) : cents;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(amount / 100);
}

export function formatPercent(ratio: number, decimals = 1): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "percent",
    maximumFractionDigits: decimals,
  }).format(ratio);
}

export function parseCents(euroString: string): bigint {
  const cleaned = euroString.replace(",", ".").replace(/\s/g, "");
  const amount = Number.parseFloat(cleaned);
  if (Number.isNaN(amount)) return BigInt(0);
  return BigInt(Math.round(amount * 100));
}

export function centsToEuro(cents: bigint | number): string {
  const n = typeof cents === "bigint" ? Number(cents) : cents;
  return (n / 100).toFixed(2);
}
