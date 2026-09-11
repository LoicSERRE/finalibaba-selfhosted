"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { downloadFile } from "@/lib/utils/markdown-export";
import { useTranslations } from "next-intl";
import type {
  FiatAccountExport,
  InvestAccountExport,
  RealEstateAccountExport,
  AutomobileAccountExport,
  LoanAccountExport,
} from "@/lib/domain/accounts-export";
import { buildMarkdown, type ExportStrings } from "@/lib/utils/accounts-markdown";

// ── Component ─────────────────────────────────────────────────────────────────

type AccountGroup = { label: string; accounts: { id: string; label: string }[] };

type Props = {
  fiatAccounts: FiatAccountExport[];
  investAccounts: InvestAccountExport[];
  realEstateAccounts: RealEstateAccountExport[];
  automobileAccounts: AutomobileAccountExport[];
  loanAccounts: LoanAccountExport[];
};

export function ExportAccountsButton({
  fiatAccounts,
  investAccounts,
  realEstateAccounts,
  automobileAccounts,
  loanAccounts,
}: Readonly<Props>) {
  const t = useTranslations("exportAccounts");
  const ta = useTranslations("accountTypes");

  const groups: AccountGroup[] = [
    {
      label: t("groupCash"),
      accounts: fiatAccounts.map((a) => ({
        id: a.id,
        label: `${a.institutionName} - ${a.name}`,
      })),
    },
    {
      label: t("groupInvestments"),
      accounts: investAccounts.map((a) => ({
        id: a.id,
        label: `${a.institutionName} - ${a.name}`,
      })),
    },
    {
      label: t("groupRealEstate"),
      accounts: realEstateAccounts.map((a) => ({
        id: a.id,
        label: `${a.institutionName} - ${a.name}`,
      })),
    },
    {
      label: t("groupAutos"),
      accounts: automobileAccounts.map((a) => ({
        id: a.id,
        label: `${a.institutionName} - ${a.name}`,
      })),
    },
    {
      label: t("groupLoans"),
      accounts: loanAccounts.map((a) => ({
        id: a.id,
        label: a.institutionName ? `${a.institutionName} - ${a.name}` : a.name,
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
      loans: t("groupLoans"),
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
      colTarget: t("mdColTarget"),
      amountBorrowed: t("mdAmountBorrowed"),
      remaining: t("mdRemaining"),
      taeg: t("mdTaeg"),
      duration: t("mdDuration"),
      months: t("mdMonths"),
      currentPayment: t("mdCurrentPayment"),
      totalCost: t("mdTotalCost"),
      projectedEnd: t("mdProjectedEnd"),
      progress: t("mdProgress"),
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
      loanAccounts.filter((a) => selected.has(a.id)),
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
          <button type="button" className="flex cursor-pointer items-center gap-1.5 px-3 py-1.5 min-h-[44px] text-sm text-[var(--muted)] border border-[var(--border)] rounded-lg hover:text-[var(--foreground)] hover:border-[var(--accent)]/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]">
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
