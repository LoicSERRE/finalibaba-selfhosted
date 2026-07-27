// next-intl locale ("en" | "fr") -> Intl.DateTimeFormat/toLocaleDateString locale tag.
// Used for date formatting only - formatCurrency/formatPercent below stay on
// fr-FR regardless of UI locale (amounts are always EUR-denominated here, and
// making that locale-aware is a separate, much larger change).
export function localeToIntl(locale: string): string {
  return locale === "en" ? "en-US" : "fr-FR";
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
  const amount = parseFloat(cleaned);
  if (isNaN(amount)) return BigInt(0);
  return BigInt(Math.round(amount * 100));
}

export function centsToEuro(cents: bigint | number): string {
  const n = typeof cents === "bigint" ? Number(cents) : cents;
  return (n / 100).toFixed(2);
}
