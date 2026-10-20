/**
 * The accounts markdown document. Pure: data in, one string out.
 *
 * Split out of components/shared/export-accounts-button.tsx at v2.10.4, same
 * shape as analytics-markdown.ts. Worth having on its own: lizard puts
 * buildMarkdown at 30 cyclomatic complexity, and it was sitting inside a
 * component where nothing could test it.
 */
import { exportFormat, nameMentions } from "@/lib/utils/markdown-export";
import type {
  FiatAccountExport,
  InvestAccountExport,
  RealEstateAccountExport,
  AutomobileAccountExport,
  LoanAccountExport,
} from "@/lib/domain/accounts-export";
import { baseCurrency } from "@/lib/utils/base-currency";

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
  /** "**label** : value" - the separator's spacing is the language's own. */
  field: (label: string, value: string) => string;
};

// ── Markdown generation ───────────────────────────────────────────────────────

// "<institution> · <qualifiers> - <name>", dropping any qualifier the name
// already says: a Trade Republic account is named "PEA" with subtype "PEA".
function accountHeading(institution: string, qualifiers: Array<string | null>, name: string): string {
  const parts = [institution];
  for (const q of qualifiers) {
    if (q && !nameMentions(name, q)) parts.push(q);
  }
  return `### ${parts.join(" · ")} - ${name}`;
}

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
  s: ExportStrings,
  intlLocale: string
): string {
  const f = exportFormat(intlLocale);
  const item = (label: string, value: string) => `- ${s.field(label, value)}`;
  const lines: string[] = [`# ${s.title} - ${f.longDate(new Date())}`, ""];

  if (fiat.length > 0) {
    lines.push(`## ${s.cash}`, "");
    for (const a of fiat) {
      lines.push(accountHeading(a.institutionName, [s.typeLabels[a.type] ?? a.type], a.name));
      lines.push(item(s.balance, f.money(a.balanceCents)));
      if (a.deltaCents !== 0) {
        lines.push(item(s.delta, f.signedMoney(a.deltaCents)));
      }
      lines.push("");
    }
  }

  if (invest.length > 0) {
    lines.push(`## ${s.investments}`, "");
    for (const a of invest) {
      const subtype = a.type === "CRYPTO" ? null : a.investmentSubtype;
      lines.push(accountHeading(a.institutionName, [s.typeLabels[a.type] ?? a.type, subtype], a.name));

      const parts: string[] = [s.field(s.total, f.money(a.totalCents))];
      if (a.gainCents !== null) {
        parts.push(s.field(s.gain, f.signedMoney(a.gainCents)));
      }
      if (a.taxCents !== null && a.taxCents > 0) {
        parts.push(s.field(s.tax, `-${f.money(a.taxCents)}`));
      }
      lines.push(parts.join("  ·  "), "");

      if (a.holdings.length > 0) {
        lines.push(
          `| ${s.colAsset} | ${s.colIsin} | ${s.colQty} | ${s.colPrice} | ${s.colValue} | ${s.colPct} | ${s.colGain} | ${s.colTarget} |`
        );
        lines.push("|---|---|---|---|---|---|---|---|");
        for (const h of a.holdings) {
          const gainPctSuffix = h.gainPct !== null ? ` (${f.signedPct(h.gainPct, 1)})` : "";
          const gainStr = h.gainCents !== null ? `${f.signedMoney(h.gainCents)}${gainPctSuffix}` : "-";
          const targetStr = h.targetPct !== null ? f.pct(h.targetPct) : "-";
          const currencySuffix = h.currency !== baseCurrency() ? ` · ${h.currency}` : "";
          const nameStr = `${h.name ?? h.ticker}${currencySuffix}`;
          lines.push(
            `| ${nameStr} | ${h.ticker} | ${f.quantity(h.quantity)} | ${f.money(h.lastPriceCents, 2)} | ${f.money(h.valueCents)} | ${f.pct(h.pct)} | ${gainStr} | ${targetStr} |`
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
      lines.push(item(s.institution, p.institutionName));
      lines.push(item(s.value, f.money(p.valueCents)));
      if (p.liabilityCents > 0) {
        lines.push(item(s.liability, f.money(p.liabilityCents)));
        lines.push(item(s.equity, f.money(p.equityCents)));
        lines.push(item("LTV", f.pct(p.ltv)));
      }
      lines.push("");
    }
  }

  if (automobiles.length > 0) {
    lines.push(`## ${s.autos}`, "");
    for (const a of automobiles) {
      lines.push(`### ${a.name}`);
      lines.push(item(s.institution, a.institutionName));
      if (a.purchasePriceCents > 0) {
        lines.push(item(s.purchasePrice, f.money(a.purchasePriceCents)));
      }
      const depStr =
        a.depreciationCents !== null && a.depreciationPct !== null
          ? ` (${f.signedMoney(a.depreciationCents)}, ${f.pct(a.depreciationPct)})`
          : "";
      lines.push(item(s.currentValue, `${f.money(a.valueCents)}${depStr}`));
      if (a.liabilityCents > 0) {
        lines.push(item(s.loanDue, f.money(a.liabilityCents)));
      }
      lines.push(item(s.netValue, f.money(a.equityCents)));
      lines.push("");
    }
  }

  if (loans.length > 0) {
    lines.push(`## ${s.loans}`, "");
    for (const l of loans) {
      const institutionPrefix = l.institutionName ? `${l.institutionName} · ` : "";
      lines.push(`### ${institutionPrefix}${l.name}`);
      lines.push(item(s.amountBorrowed, f.money(l.amountBorrowedCents)));
      lines.push(item(s.remaining, f.money(l.remainingCapitalCents)));
      lines.push(item(s.taeg, f.pct(l.taeg, 2)));
      lines.push(item(s.duration, `${l.durationMonths} ${s.months}`));
      lines.push(item(s.currentPayment, f.money(l.currentPaymentCents)));
      lines.push(item(s.totalCost, f.money(l.totalCostCents)));
      lines.push(item(s.projectedEnd, l.projectedEnd));
      lines.push(item(s.progress, f.pct(l.progressPct)));
      lines.push("");
    }
  }

  return lines.join("\n");
}
