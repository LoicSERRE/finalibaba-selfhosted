import { describe, expect, it } from "vitest";
import { buildTransactionsCsv, csvAmount, csvText, type CsvStrings, type CsvTransaction } from "@/lib/utils/transactions-csv";

/**
 * The ledger CSV (v2.14). What a spreadsheet does with it is the test: the
 * dialect must match the language (a French Excel splits on ";" and reads
 * "12,34" as a number), amounts must not go through a float, and a label or
 * note must never run as a formula when the file is opened.
 */

const S: CsvStrings = {
  date: "Date", account: "Compte", label: "Libellé", amount: "Montant", currency: "Devise",
  category: "Catégorie", note: "Note", tags: "Étiquettes", uncategorized: "Sans catégorie",
};

const ROW: CsvTransaction = {
  date: new Date("2026-10-19T12:00:00.000Z"),
  account: "Compte courant",
  label: "CARREFOUR",
  amountCents: BigInt(-12_345),
  category: "Alimentation",
  splits: [],
  note: null,
  tags: [],
};

const lines = (csv: string) => csv.replace(/^﻿/, "").split("\r\n").filter(Boolean);

describe("dialect", () => {
  it("is ; and a decimal comma in French, , and a point in English", () => {
    expect(lines(buildTransactionsCsv([ROW], S, "fr-FR"))[1]).toBe("2026-10-19;Compte courant;CARREFOUR;-123,45;EUR;Alimentation;;");
    expect(lines(buildTransactionsCsv([ROW], S, "en-US"))[1]).toBe("2026-10-19,Compte courant,CARREFOUR,-123.45,EUR,Alimentation,,");
  });

  it("starts with a BOM, ends lines with CRLF, and puts the header first", () => {
    const csv = buildTransactionsCsv([ROW], S, "fr-FR");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(lines(csv)[0]).toBe("Date;Compte;Libellé;Montant;Devise;Catégorie;Note;Étiquettes");
  });
});

describe("amounts", () => {
  it("are exact, without a float on the way", () => {
    expect(csvAmount(BigInt(5), ",")).toBe("0,05");
    expect(csvAmount(BigInt(-1), ".")).toBe("-0.01");
    expect(csvAmount(BigInt("900719925474099312"), ".")).toBe("9007199254740993.12");
  });
});

describe("text cells", () => {
  it("are defused when they would run as a formula", () => {
    for (const evil of ["=HYPERLINK(\"x\")", "+1", "-2+3", "@SUM(A1)", "\tx"]) {
      expect(csvText(evil, ";").replace(/^"/, "").startsWith("'")).toBe(true);
    }
    expect(csvText("CARREFOUR", ";")).toBe("CARREFOUR");
  });

  it("are quoted when they hold the separator, a quote, a line break or edge spaces", () => {
    expect(csvText("a;b", ";")).toBe('"a;b"');
    expect(csvText("a;b", ",")).toBe("a;b");
    expect(csvText('dit "ok"', ";")).toBe('"dit ""ok"""');
    expect(csvText("ligne\nsuivante", ";")).toBe('"ligne\nsuivante"');
    expect(csvText(" x", ";")).toBe('" x"');
  });
});

describe("rows", () => {
  it("spell a split out line by line instead of leaving the category empty", () => {
    const split: CsvTransaction = {
      ...ROW, category: null,
      splits: [{ category: "Alimentation", amountCents: BigInt(-10_000) }, { category: null, amountCents: BigInt(-2_345) }],
    };
    expect(lines(buildTransactionsCsv([split], S, "fr-FR"))[1]).toContain(";Alimentation -100,00 + Sans catégorie -23,45;");
  });

  it("carry the note and the tags, quoted when needed", () => {
    const row: CsvTransaction = { ...ROW, note: "remboursé; voir mail", tags: ["vacances", "frais pro"] };
    const line = lines(buildTransactionsCsv([row], S, "fr-FR"))[1];
    expect(line.endsWith(';"remboursé; voir mail";"vacances, frais pro"')).toBe(false);
    expect(line.endsWith(';"remboursé; voir mail";vacances, frais pro')).toBe(true);
    expect(lines(buildTransactionsCsv([row], S, "en-US"))[1].endsWith(',remboursé; voir mail,"vacances, frais pro"')).toBe(true);
  });

  it("leave an uncategorized transaction's category empty", () => {
    expect(lines(buildTransactionsCsv([{ ...ROW, category: null }], S, "fr-FR"))[1]).toContain(";EUR;;");
  });
});
