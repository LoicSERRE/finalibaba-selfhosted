"use client";

import { useMemo, useState, useTransition } from "react";
import Papa from "papaparse";
import { Upload } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TruncatedText } from "@/components/ui/truncated-text";
import { importTransactions } from "@/lib/actions/transactions";
import { parseCents, formatCurrency } from "@/lib/utils/format";
import { parseCsvDate, looksNumeric, makeHeaderNormalizer } from "@/lib/domain/csv-import";
import { useTranslations } from "next-intl";

type ParsedRow = {
  date: string; // ISO yyyy-mm-dd, "" if unparseable
  label: string;
  amountCents: number;
  fingerprint: string;
  isDuplicate: boolean;
  error?: string;
};

// Canonical column names the import expects, plus common aliases (French bank exports, etc.)
const normalizeHeader = makeHeaderNormalizer({
  date: "date",
  label: "label",
  libelle: "label",
  "libellé": "label",
  description: "label",
  amount: "amount",
  montant: "amount",
  value: "amount",
});

export function ImportTransactionsDialog({
  accountId,
  existingFingerprints,
}: Readonly<{
  accountId: string;
  existingFingerprints: string[];
}>) {
  const t = useTranslations("importTransactions");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [parseError, setParseError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<number | null>(null);

  const existing = useMemo(() => new Set(existingFingerprints), [existingFingerprints]);

  function reset() {
    setRows([]);
    setSelected(new Set());
    setParseError(null);
    setResult(null);
  }

  function handleFile(file: File) {
    setParseError(null);
    setResult(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: normalizeHeader,
      complete: (results) => {
        const fields = results.meta.fields ?? [];
        if (!fields.includes("date") || !fields.includes("label") || !fields.includes("amount")) {
          setParseError(t("missingColumns"));
          return;
        }
        const parsed: ParsedRow[] = results.data.map((raw) => {
          const isoDate = parseCsvDate(raw.date ?? "");
          const label = (raw.label ?? "").trim();
          const amountCents = Number(parseCents(raw.amount ?? ""));
          const error = !isoDate
            ? t("invalidDate")
            : !label
            ? t("missingLabel")
            : !looksNumeric(raw.amount ?? "") || amountCents === 0
            ? t("invalidAmount")
            : undefined;
          const fingerprint = `${isoDate ?? ""}|${label.toLowerCase()}|${amountCents}`;
          return {
            date: isoDate ?? "",
            label,
            amountCents,
            fingerprint,
            isDuplicate: !error && existing.has(fingerprint),
            error,
          };
        });
        setRows(parsed);
        setSelected(new Set(parsed.map((_, i) => i).filter((i) => !parsed[i].error && !parsed[i].isDuplicate)));
      },
      error: () => setParseError(t("parseError")),
    });
  }

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function handleImport() {
    const toImport = rows
      .filter((_, i) => selected.has(i))
      .map((r) => ({ date: r.date, label: r.label, amountCents: r.amountCents }));
    if (toImport.length === 0) return;
    startTransition(async () => {
      const { imported } = await importTransactions(accountId, toImport);
      setResult(imported);
      setRows([]);
      setSelected(new Set());
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
      title={t("title")}
      trigger={
        <Button variant="outline" size="sm">
          <Upload size={12} aria-hidden="true" />
          {t("trigger")}
        </Button>
      }
    >
      <div className="space-y-4">
        {result !== null ? (
          <p className="text-sm text-[var(--positive)]">{t("success", { count: result })}</p>
        ) : rows.length === 0 ? (
          <>
            <p className="text-xs text-[var(--muted)]">{t("hint")}</p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
              className="w-full text-sm text-[var(--foreground)] file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[var(--surface-elevated)] file:text-[var(--foreground)] file:cursor-pointer cursor-pointer"
            />
            {parseError && <p className="text-sm text-[var(--negative)]">{parseError}</p>}
          </>
        ) : (
          <>
            <div className="max-h-80 overflow-y-auto border border-[var(--border)] rounded-lg">
              <table className="w-full text-xs">
                <tbody>
                  {rows.map((r, i) => (
                    // See import-balance-history-dialog.tsx: `i` is the
                    // row's identity (selected.has(i)/toggle(i)), and `rows`
                    // is parsed once and never reordered/filtered.
                    <tr
                      key={i} // NOSONAR (typescript:S6479)
                      className={`border-b border-[var(--border)] last:border-0 ${r.error ? "opacity-50" : ""}`}
                    >
                      <td className="px-2 py-1.5">
                        <input type="checkbox" checked={selected.has(i)} disabled={!!r.error} onChange={() => toggle(i)} />
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-[var(--muted)]">{r.date || "-"}</td>
                      <td className="px-2 py-1.5 max-w-[160px]">
                        <TruncatedText text={r.label} className="w-full" />
                      </td>
                      <td
                        className={`px-2 py-1.5 text-right tabular-nums whitespace-nowrap ${
                          r.amountCents >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"
                        }`}
                      >
                        {formatCurrency(r.amountCents)}
                      </td>
                      <td className="px-2 py-1.5 text-[var(--muted)] whitespace-nowrap">
                        {r.error ?? (r.isDuplicate ? t("duplicate") : "")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-[var(--muted)]">{t("selectedCount", { count: selected.size, total: rows.length })}</p>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={reset} disabled={pending}>
                {tc("cancel")}
              </Button>
              <Button onClick={handleImport} disabled={selected.size === 0 || pending}>
                <Upload size={14} aria-hidden="true" />
                {pending ? t("importing") : t("importSelected", { count: selected.size })}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
