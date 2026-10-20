import { baseCurrency } from "@/lib/utils/base-currency";
/**
 * The ledger as CSV (v2.14). Pure: rows in, one string out.
 *
 * Written for the spreadsheet the person will open it in, so the dialect
 * follows the UI language: French Excel/LibreOffice expect ";" between
 * fields and a decimal comma, English ones "," and a point. Dates are ISO
 * (sortable, unambiguous in both). A UTF-8 BOM makes Excel read accents.
 *
 * Text cells are defused against formula injection: a label comes from the
 * bank and a note from anyone with write access, and a cell starting with
 * = + - @ (or a tab/CR) is executed as a formula by spreadsheet software.
 * Such a cell gets a leading apostrophe (OWASP's recommendation). Amounts are
 * numbers, not text, and stay as they are.
 */

export type CsvTransaction = {
  date: Date;
  account: string;
  label: string;
  amountCents: bigint;
  category: string | null;
  splits: { category: string | null; amountCents: bigint }[];
  note: string | null;
  tags: string[];
};

export type CsvStrings = {
  date: string;
  account: string;
  label: string;
  amount: string;
  currency: string;
  category: string;
  note: string;
  tags: string;
  uncategorized: string;
};

type Dialect = { separator: string; decimal: string };

export function csvDialect(intlLocale: string): Dialect {
  return intlLocale.startsWith("fr") ? { separator: ";", decimal: "," } : { separator: ",", decimal: "." };
}

/** Integer cents to "-12,34" / "-12.34", no float on the way. */
export function csvAmount(cents: bigint, decimal: string): string {
  const negative = cents < BigInt(0);
  const abs = negative ? -cents : cents;
  const units = abs / BigInt(100);
  const rest = (abs % BigInt(100)).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${units}${decimal}${rest}`;
}

const FORMULA_START = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** A text cell, defused and quoted as needed. */
export function csvText(value: string, separator: string): string {
  const defused = value !== "" && FORMULA_START.has(value[0]) ? `'${value}` : value;
  const mustQuote =
    defused.includes(separator) || defused.includes('"') || defused.includes("\n") || defused.includes("\r") || defused !== defused.trim();
  return mustQuote ? `"${defused.replaceAll('"', '""')}"` : defused;
}

function categoryCell(row: CsvTransaction, s: CsvStrings, decimal: string): string {
  if (row.splits.length > 0) {
    return row.splits.map((split) => `${split.category ?? s.uncategorized} ${csvAmount(split.amountCents, decimal)}`).join(" + ");
  }
  return row.category ?? "";
}

export function buildTransactionsCsv(rows: CsvTransaction[], s: CsvStrings, intlLocale: string): string {
  const { separator, decimal } = csvDialect(intlLocale);
  const text = (value: string) => csvText(value, separator);
  const header = [s.date, s.account, s.label, s.amount, s.currency, s.category, s.note, s.tags].map(text).join(separator);
  const lines = rows.map((row) =>
    [
      row.date.toISOString().slice(0, 10),
      text(row.account),
      text(row.label),
      csvAmount(row.amountCents, decimal),
      baseCurrency(),
      text(categoryCell(row, s, decimal)),
      text(row.note ?? ""),
      text(row.tags.join(", ")),
    ].join(separator)
  );
  return `﻿${[header, ...lines].join("\r\n")}\r\n`;
}
