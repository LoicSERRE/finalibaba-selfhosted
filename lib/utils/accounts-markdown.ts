/**
 * The accounts markdown document. Pure: data in, one string out.
 *
 * Split out of components/shared/export-accounts-button.tsx at v2.10.4, same
 * shape as analytics-markdown.ts. Worth having on its own: lizard puts
 * buildMarkdown at 30 cyclomatic complexity, and it was sitting inside a
 * component where nothing could test it.
 */
import { fmt, sign } from "@/lib/utils/markdown-export";
import type {
  FiatAccountExport,
  InvestAccountExport,
  RealEstateAccountExport,
  AutomobileAccountExport,
  LoanAccountExport,
} from "@/lib/domain/accounts-export";

// ── ExportStrings ─────────────────────────────────────────────────────────────

export type ExportStrings = {
  title: string;
  cash: string;
  investments: string;
  realEstate: string;
  autos: string;
  loans: string;
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
  colTarget: string;
  amountBorrowed: string;
  remaining: string;
  taeg: string;
  duration: string;
  months: string;
  currentPayment: string;
  totalCost: string;
  projectedEnd: string;
  progress: string;
  typeLabels: Record<string, string>;
};

// ── Markdown generation ───────────────────────────────────────────────────────

// Single-pass markdown builder covering every account-type section - see
// __tests__/export-completeness.test.ts, which specifically depends on every
// field being wired into this one function so a completeness check can find
// it. Splitting per-section would scatter that guarantee across files.
// eslint-disable-next-line sonarjs/cognitive-complexity
export function buildMarkdown(
  fiat: FiatAccountExport[],
  invest: InvestAccountExport[],
  realEstate: RealEstateAccountExport[],
  automobiles: AutomobileAccountExport[],
  loans: LoanAccountExport[],
  s: ExportStrings
): string {
  const date = new Date().toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const lines: string[] = [`# ${s.title} - ${date}`, ""];

  if (fiat.length > 0) {
    lines.push(`## ${s.cash}`, "");
    for (const a of fiat) {
      lines.push(
        `### ${a.institutionName} · ${s.typeLabels[a.type] ?? a.type} - ${a.name}`
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
      const subtypeSuffix = a.investmentSubtype ? ` · ${a.investmentSubtype}` : "";
      const typeLabel =
        a.type === "CRYPTO"
          ? s.typeLabels["CRYPTO"] ?? a.type
          : `${s.typeLabels[a.type] ?? a.type}${subtypeSuffix}`;
      lines.push(`### ${a.institutionName} · ${typeLabel} - ${a.name}`);

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
          `| ${s.colAsset} | ${s.colIsin} | ${s.colQty} | ${s.colPrice} | ${s.colValue} | ${s.colPct} | ${s.colGain} | ${s.colTarget} |`
        );
        lines.push("|---|---|---|---|---|---|---|---|");
        for (const h of a.holdings) {
          const gainPctSuffix = h.gainPct !== null ? ` (${sign(h.gainPct)}${h.gainPct.toFixed(1)}%)` : "";
          const gainStr = h.gainCents !== null ? `${sign(h.gainCents)}${fmt(h.gainCents)}${gainPctSuffix}` : "-";
          const targetStr = h.targetPct !== null ? `${h.targetPct}%` : "-";
          const currencySuffix = h.currency !== "EUR" ? ` · ${h.currency}` : "";
          const nameStr = `${h.name ?? h.ticker}${currencySuffix}`;
          lines.push(
            `| ${nameStr} | ${h.ticker} | ${h.quantity} | ${fmt(h.lastPriceCents, 2)} | ${fmt(h.valueCents)} | ${h.pct}% | ${gainStr} | ${targetStr} |`
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

  if (loans.length > 0) {
    lines.push(`## ${s.loans}`, "");
    for (const l of loans) {
      const institutionPrefix = l.institutionName ? `${l.institutionName} · ` : "";
      lines.push(`### ${institutionPrefix}${l.name}`);
      lines.push(`- **${s.amountBorrowed}** : ${fmt(l.amountBorrowedCents)}`);
      lines.push(`- **${s.remaining}** : ${fmt(l.remainingCapitalCents)}`);
      lines.push(`- **${s.taeg}** : ${l.taeg.toFixed(2)}%`);
      lines.push(`- **${s.duration}** : ${l.durationMonths} ${s.months}`);
      lines.push(`- **${s.currentPayment}** : ${fmt(l.currentPaymentCents)}`);
      lines.push(`- **${s.totalCost}** : ${fmt(l.totalCostCents)}`);
      lines.push(`- **${s.projectedEnd}** : ${l.projectedEnd}`);
      lines.push(`- **${s.progress}** : ${l.progressPct}%`);
      lines.push("");
    }
  }

  return lines.join("\n");
}
