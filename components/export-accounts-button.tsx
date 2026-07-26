"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fmt, sign, downloadFile } from "@/lib/markdown-export";
import { useTranslations } from "next-intl";

// ── Serialized types (no BigInt) ──────────────────────────────────────────────

export type FiatAccountExport = {
  id: string;
  name: string;
  institutionName: string;
  type: string;
  balanceCents: number;
  deltaCents: number;
};

export type HoldingExport = {
  ticker: string;
  name: string | null;
  quantity: string;
  lastPriceCents: number;
  valueCents: number;
  pct: number;
  costBasisCents: number | null;
  gainCents: number | null;
  gainPct: number | null;
  taxCents: number | null;
};

export type InvestAccountExport = {
  id: string;
  name: string;
  institutionName: string;
  type: string;
  investmentSubtype: string | null;
  totalCents: number;
  gainCents: number | null;
  taxCents: number | null;
  holdings: HoldingExport[];
};

export type RealEstateAccountExport = {
  id: string;
  name: string;
  institutionName: string;
  valueCents: number;
  liabilityCents: number;
  equityCents: number;
  ltv: number;
};

export type AutomobileAccountExport = {
  id: string;
  name: string;
  institutionName: string;
  valueCents: number;
  purchasePriceCents: number;
  liabilityCents: number;
  equityCents: number;
  depreciationCents: number | null;
  depreciationPct: number | null;
};

// ── ExportStrings ─────────────────────────────────────────────────────────────

type ExportStrings = {
  title: string;
  cash: string;
  investments: string;
  realEstate: string;
  autos: string;
  balance: string;
  delta: string;
  total: string;
  gain: string;
  tax: string;
  value: string;
  liability: string;
  equity: string;
  purchasePrice: string;
  currentValue: string;
  netValue: string;
  institution: string;
  loanDue: string;
  colAsset: string;
  colIsin: string;
  colQty: string;
  colPrice: string;
  colValue: string;
  colPct: string;
  colGain: string;
  typeLabels: Record<string, string>;
};

// ── Markdown generation ───────────────────────────────────────────────────────

function buildMarkdown(
  fiat: FiatAccountExport[],
  invest: InvestAccountExport[],
  realEstate: RealEstateAccountExport[],
  automobiles: AutomobileAccountExport[],
  s: ExportStrings
): string {
  const date = new Date().toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const lines: string[] = [`# ${s.title} — ${date}`, ""];

  if (fiat.length > 0) {
    lines.push(`## ${s.cash}`, "");
    for (const a of fiat) {
      lines.push(
        `### ${a.institutionName} · ${s.typeLabels[a.type] ?? a.type} — ${a.name}`
      );
      lines.push(`- **${s.balance}** : ${fmt(a.balanceCents)}`);
      if (a.deltaCents !== 0) {
        lines.push(`- **${s.delta}** : ${sign(a.deltaCents)}${fmt(a.deltaCents)}`);
      }
      lines.push("");
    }
  }

  if (invest.length > 0) {
    lines.push(`## ${s.investments}`, "");
    for (const a of invest) {
      const typeLabel =
        a.type === "CRYPTO"
          ? s.typeLabels["CRYPTO"] ?? a.type
          : `${s.typeLabels[a.type] ?? a.type}${a.investmentSubtype ? ` · ${a.investmentSubtype}` : ""}`;
      lines.push(`### ${a.institutionName} · ${typeLabel} — ${a.name}`);

      const parts: string[] = [`**${s.total}** : ${fmt(a.totalCents)}`];
      if (a.gainCents !== null) {
        parts.push(`**${s.gain}** : ${sign(a.gainCents)}${fmt(a.gainCents)}`);
      }
      if (a.taxCents !== null && a.taxCents > 0) {
        parts.push(`**${s.tax}** : -${fmt(a.taxCents)}`);
      }
      lines.push(parts.join("  ·  "), "");

      if (a.holdings.length > 0) {
        lines.push(
          `| ${s.colAsset} | ${s.colIsin} | ${s.colQty} | ${s.colPrice} | ${s.colValue} | ${s.colPct} | ${s.colGain} |`
        );
        lines.push("|---|---|---|---|---|---|---|");
        for (const h of a.holdings) {
          const gainStr =
            h.gainCents !== null
              ? `${sign(h.gainCents)}${fmt(h.gainCents)}${h.gainPct !== null ? ` (${sign(h.gainPct)}${h.gainPct.toFixed(1)}%)` : ""}`
              : "—";
          lines.push(
            `| ${h.name ?? h.ticker} | ${h.ticker} | ${h.quantity} | ${fmt(h.lastPriceCents, 2)} | ${fmt(h.valueCents)} | ${h.pct}% | ${gainStr} |`
          );
        }
        lines.push("");
      }
    }
  }

  if (realEstate.length > 0) {
    lines.push(`## ${s.realEstate}`, "");
    for (const p of realEstate) {
      lines.push(`### ${p.name}`);
      lines.push(`- **${s.institution}** : ${p.institutionName}`);
      lines.push(`- **${s.value}** : ${fmt(p.valueCents)}`);
      if (p.liabilityCents > 0) {
        lines.push(`- **${s.liability}** : ${fmt(p.liabilityCents)}`);
        lines.push(`- **${s.equity}** : ${fmt(p.equityCents)}`);
        lines.push(`- **LTV** : ${p.ltv}%`);
      }
      lines.push("");
    }
  }

  if (automobiles.length > 0) {
    lines.push(`## ${s.autos}`, "");
    for (const a of automobiles) {
      lines.push(`### ${a.name}`);
      lines.push(`- **${s.institution}** : ${a.institutionName}`);
      if (a.purchasePriceCents > 0) {
        lines.push(`- **${s.purchasePrice}** : ${fmt(a.purchasePriceCents)}`);
      }
      const depStr =
        a.depreciationCents !== null
          ? ` (${sign(a.depreciationCents)}${fmt(a.depreciationCents)}, ${a.depreciationPct}%)`
          : "";
      lines.push(`- **${s.currentValue}** : ${fmt(a.valueCents)}${depStr}`);
      if (a.liabilityCents > 0) {
        lines.push(`- **${s.loanDue}** : ${fmt(a.liabilityCents)}`);
      }
      lines.push(`- **${s.netValue}** : ${fmt(a.equityCents)}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ── Component ─────────────────────────────────────────────────────────────────

type AccountGroup = { label: string; accounts: { id: string; label: string }[] };

type Props = {
  fiatAccounts: FiatAccountExport[];
  investAccounts: InvestAccountExport[];
  realEstateAccounts: RealEstateAccountExport[];
  automobileAccounts: AutomobileAccountExport[];
};

export function ExportAccountsButton({
  fiatAccounts,
  investAccounts,
  realEstateAccounts,
  automobileAccounts,
}: Props) {
  const t = useTranslations("exportAccounts");
  const ta = useTranslations("accountTypes");

  const groups: AccountGroup[] = [
    {
      label: t("groupCash"),
      accounts: fiatAccounts.map((a) => ({
        id: a.id,
        label: `${a.institutionName} — ${a.name}`,
      })),
    },
    {
      label: t("groupInvestments"),
      accounts: investAccounts.map((a) => ({
        id: a.id,
        label: `${a.institutionName} — ${a.name}`,
      })),
    },
    {
      label: t("groupRealEstate"),
      accounts: realEstateAccounts.map((a) => ({
        id: a.id,
        label: `${a.institutionName} — ${a.name}`,
      })),
    },
    {
      label: t("groupAutos"),
      accounts: automobileAccounts.map((a) => ({
        id: a.id,
        label: `${a.institutionName} — ${a.name}`,
      })),
    },
  ].filter((g) => g.accounts.length > 0);

  const allIds = groups.flatMap((g) => g.accounts.map((a) => a.id));

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(allIds));

  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const selectedCount = allIds.filter((id) => selected.has(id)).length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allIds));
  }

  function toggleGroup(g: AccountGroup) {
    const ids = g.accounts.map((a) => a.id);
    const allOn = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  function handleExport() {
    const exportStrings: ExportStrings = {
      title: t("mdTitle"),
      cash: t("groupCash"),
      investments: t("groupInvestments"),
      realEstate: t("groupRealEstate"),
      autos: t("groupAutos"),
      balance: t("mdBalance"),
      delta: t("mdDelta"),
      total: t("mdTotal"),
      gain: t("mdGain"),
      tax: t("mdTax"),
      value: t("mdValue"),
      liability: t("mdLiability"),
      equity: t("mdEquity"),
      purchasePrice: t("mdPurchasePrice"),
      currentValue: t("mdCurrentValue"),
      netValue: t("mdNetValue"),
      institution: t("mdInstitution"),
      loanDue: t("mdLoanDue"),
      colAsset: t("mdColAsset"),
      colIsin: t("mdColIsin"),
      colQty: t("mdColQty"),
      colPrice: t("mdColPrice"),
      colValue: t("mdColValue"),
      colPct: t("mdColPct"),
      colGain: t("mdColGain"),
      typeLabels: {
        CHECKING: ta("CHECKING"),
        SAVINGS: ta("SAVINGS"),
        MEAL_VOUCHER: ta("MEAL_VOUCHER"),
        INVESTMENT: ta("INVESTMENT"),
        CRYPTO: ta("CRYPTO"),
      },
    };

    const md = buildMarkdown(
      fiatAccounts.filter((a) => selected.has(a.id)),
      investAccounts.filter((a) => selected.has(a.id)),
      realEstateAccounts.filter((a) => selected.has(a.id)),
      automobileAccounts.filter((a) => selected.has(a.id)),
      exportStrings
    );
    downloadFile(md, "comptes");
    setOpen(false);
  }

  return (
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t("title")}
        trigger={
          <button className="flex cursor-pointer items-center gap-1.5 px-3 py-1.5 min-h-[44px] text-sm text-[var(--muted)] border border-[var(--border)] rounded-lg hover:text-[var(--foreground)] hover:border-[var(--accent)]/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]">
            <Download size={14} aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">{t("button")}</span>
          </button>
        }
      >
        <div className="space-y-4">
          {/* Account list */}
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="w-4 h-4 rounded accent-[var(--accent)]"
              />
              <span className="text-sm font-medium text-[var(--foreground)]">
                {t("selectAll")}
              </span>
            </label>

            <div className="border-t border-[var(--border)]" />

            {groups.map((g) => {
              const allOn = g.accounts.every((a) => selected.has(a.id));
              return (
                <div key={g.label} className="space-y-2">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allOn}
                      onChange={() => toggleGroup(g)}
                      className="w-4 h-4 rounded accent-[var(--accent)]"
                    />
                    <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                      {g.label}
                    </span>
                  </label>
                  <div className="ml-7 space-y-1.5">
                    {g.accounts.map((a) => (
                      <label key={a.id} className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selected.has(a.id)}
                          onChange={() => toggle(a.id)}
                          className="w-4 h-4 rounded accent-[var(--accent)]"
                        />
                        <span className="text-sm text-[var(--foreground)]">{a.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
            <span className="text-xs text-[var(--muted)]">
              {selectedCount === 1
                ? t("selectedOne", { count: selectedCount })
                : t("selectedMany", { count: selectedCount })}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("cancel")}
              </Button>
              <Button type="button" onClick={handleExport} disabled={selectedCount === 0}>
                <Download size={14} aria-hidden="true" />
                {t("export")}
              </Button>
            </div>
          </div>
        </div>
      </Dialog>
  );
}
