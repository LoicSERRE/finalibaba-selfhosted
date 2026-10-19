// Shared by the three Markdown exports (accounts, analytics, tax report): the
// number/date formatting every one of them prints through, and the
// client-side download that hands the document over.

/**
 * Everything an export prints that is not a translated label, in one locale.
 *
 * The app's own pages format amounts and percentages as fr-FR whatever the UI
 * language (see lib/utils/format.ts) - a known, separate decision. An export
 * is different: it is a standalone document read outside the app (sent to an
 * adviser, pasted elsewhere), so it has to be correct in the language it was
 * written in. Until v2.12.5 the labels followed the UI language while every
 * figure stayed French, so an English export read "1 234 €" and "+23.4%"
 * side by side, and a French one "+23.4%" instead of "+23,4 %".
 */
export type ExportFormat = {
  /** Cents to a whole-euro amount by default ("1 234 €" / "€1,234"). */
  money(cents: number, decimals?: number): string;
  /** Same, with an explicit "+" on zero and positives. */
  signedMoney(cents: number, decimals?: number): string;
  /**
   * A value already in percent units (12.5 -> "12,5 %" / "12.5%"). `digits`
   * fixes the decimals; omitted, the value is printed as it is, up to 2.
   */
  pct(value: number, digits?: number): string;
  /** Same, with an explicit "+" on zero and positives. */
  signedPct(value: number, digits?: number): string;
  /** A holding quantity, from the decimal string the domain produced ("12.5"). */
  quantity(quantity: string): string;
  /** "28 juillet 2026" / "July 28, 2026". */
  longDate(date: Date): string;
  /** "22 avr. 2026" / "Apr 22, 2026". */
  shortDate(date: Date): string;
};

export function exportFormat(intlLocale: string): ExportFormat {
  const cache = new Map<string, Intl.NumberFormat>();
  const numberFormat = (key: string, options: Intl.NumberFormatOptions) => {
    let format = cache.get(key);
    if (!format) {
      format = new Intl.NumberFormat(intlLocale, options);
      cache.set(key, format);
    }
    return format;
  };

  const money = (cents: number, decimals: number, signed: boolean) =>
    numberFormat(`money:${decimals}:${signed}`, {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
      signDisplay: signed ? "always" : "auto",
    }).format(cents / 100);

  // Rounded with toFixed first, then only formatted: the pages print these
  // same figures with toFixed, and Intl rounds a binary half the other way
  // (23.45 is "23.4" on the page, "23,5" through Intl alone).
  const pct = (value: number, digits: number | undefined, signed: boolean) =>
    numberFormat(`pct:${digits}:${signed}`, {
      style: "percent",
      minimumFractionDigits: digits ?? 0,
      maximumFractionDigits: digits ?? 2,
      signDisplay: signed ? "always" : "auto",
    }).format((digits === undefined ? value : Number(value.toFixed(digits))) / 100);

  return {
    money: (cents, decimals = 0) => money(cents, decimals, false),
    signedMoney: (cents, decimals = 0) => money(cents, decimals, true),
    pct: (value, digits) => pct(value, digits, false),
    signedPct: (value, digits) => pct(value, digits, true),
    quantity: (quantity) => numberFormat("quantity", { maximumFractionDigits: 20 }).format(Number(quantity)),
    longDate: (date) =>
      new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "long", year: "numeric" }).format(date),
    shortDate: (date) =>
      new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", year: "numeric" }).format(date),
  };
}

function foldForMatch(text: string): string {
  return text.normalize("NFD").replaceAll(/\p{M}/gu, "").toLowerCase().trim();
}

/**
 * Whether `qualifier` already reads as a whole word in `name`, ignoring case
 * and accents. Both exports decorate an account name with its type/subtype,
 * and the Trade Republic sync names its accounts after exactly those
 * ("PEA", "CTO", "Crypto") - which printed "PEA (PEA)" and "PEA - PEA".
 */
export function nameMentions(name: string, qualifier: string): boolean {
  const q = foldForMatch(qualifier);
  if (q === "") return false;
  const escaped = q.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(String.raw`(?:^|[^\p{L}\p{N}])${escaped}(?:$|[^\p{L}\p{N}])`, "u").test(foldForMatch(name));
}

export function downloadFile(content: string, suffix: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `finalibaba-${suffix}-${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
