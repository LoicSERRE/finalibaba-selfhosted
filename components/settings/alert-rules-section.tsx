"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Plus, Pencil, Pause, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import {
  KindFields,
  type PickerOption,
  type CategoryOption,
  type InvestmentAccountOption,
  type HoldingOption,
} from "@/components/settings/alert-rule-fields";
import { DeleteButton } from "@/components/shared/delete-button";
import { EmptyState } from "@/components/shared/empty-state";
import { createAlertRule, updateAlertRule, deleteAlertRule, toggleAlertRuleActive } from "@/lib/actions/alert-rules";
import { ruleLabel, type AlertRuleKind, type AlertRuleRow } from "@/lib/domain/alert-rule-labels";


function AlertRuleDialog({
  rule,
  fiatAccounts,
  investmentAccounts,
  holdings,
  categories,
}: Readonly<{
  rule?: AlertRuleRow;
  fiatAccounts: PickerOption[];
  investmentAccounts: InvestmentAccountOption[];
  holdings: HoldingOption[];
  categories: CategoryOption[];
}>) {
  const isEdit = !!rule;
  const t = useTranslations("settings.alertRules");
  const tc = useTranslations("common");
  const router = useRouter();

  // Filtered here rather than threaded in as a separate prop - holdings is
  // already passed down, and REBALANCING_DRIFT's eligibility is just a view
  // over it (see computeHoldingDriftPts's own targetPct null guard).
  const driftEligibleHoldings = holdings.filter((h) => h.targetPct !== null);
  // NEW_TRANSACTION is the only kind whose account scope spans both fiat and
  // investment/crypto accounts (a transaction can land on either - Trade
  // Republic's own cash/trades/dividends all share one account, see
  // CLAUDE.md's "Trade Republic transaction history") - combined here from
  // the two lists already passed in, rather than a third prop from the page.
  const allAccounts: PickerOption[] = [...fiatAccounts, ...investmentAccounts.map((a) => ({ id: a.id, name: a.name }))];

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<AlertRuleKind>(rule?.kind ?? "ACCOUNT_BALANCE");

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      if (rule) {
        await updateAlertRule(rule.id, fd);
      } else {
        await createAlertRule(fd);
      }
      setOpen(false);
      router.refresh();
    });
  }

  // Only blocks submission for kinds whose picker can genuinely be empty
  // (UNREALIZED_GAIN always has the "all accounts" fallback, so it's never
  // blocked here).
  const blocked =
    !isEdit &&
    ((kind === "ACCOUNT_BALANCE" && fiatAccounts.length === 0) ||
      (kind === "ACCOUNT_OVERDRAFT" && fiatAccounts.length === 0) ||
      (kind === "INVESTMENT_VALUE" && investmentAccounts.length === 0) ||
      (kind === "HOLDING_PRICE" && holdings.length === 0) ||
      (kind === "REBALANCING_DRIFT" && driftEligibleHoldings.length === 0) ||
      (kind === "BUDGET_OVERRUN" && categories.length === 0));

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={isEdit ? t("editTitle") : t("createTitle")}
      trigger={
        isEdit ? (
          <Button variant="outline" size="sm" aria-label={tc("edit")}>
            <Pencil size={12} aria-hidden="true" />
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Plus size={14} aria-hidden="true" />
            {t("create")}
          </Button>
        )
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Select
          label={t("kindField")}
          name="kind"
          value={kind}
          disabled={isEdit}
          onChange={(e) => setKind(e.target.value as AlertRuleKind)}
          options={[
            { value: "ACCOUNT_BALANCE", label: t("kindAccountBalance") },
            { value: "ACCOUNT_OVERDRAFT", label: t("kindAccountOverdraft") },
            { value: "INVESTMENT_VALUE", label: t("kindInvestmentValue") },
            { value: "HOLDING_PRICE", label: t("kindHoldingPrice") },
            { value: "REBALANCING_DRIFT", label: t("kindRebalancingDrift") },
            { value: "UNREALIZED_GAIN", label: t("kindUnrealizedGain") },
            { value: "BUDGET_OVERRUN", label: t("kindBudgetOverrun") },
            { value: "NEW_TRANSACTION", label: t("kindNewTransaction") },
          ]}
        />

        <KindFields
          kind={kind}
          isEdit={isEdit}
          rule={rule}
          fiatAccounts={fiatAccounts}
          investmentAccounts={investmentAccounts}
          allAccounts={allAccounts}
          holdings={holdings}
          driftEligibleHoldings={driftEligibleHoldings}
          categories={categories}
          t={t}
        />

        <Input
          label={t("messageField")}
          name="message"
          type="text"
          maxLength={280}
          defaultValue={rule?.message ?? ""}
          placeholder={t("messagePlaceholder")}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {tc("cancel")}
          </Button>
          <Button type="submit" disabled={pending || blocked}>
            {pending ? (isEdit ? t("saving") : t("creating")) : isEdit ? t("save") : t("confirm")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function AlertRulesSection({
  rules,
  fiatAccounts,
  investmentAccounts,
  categories,
}: Readonly<{
  rules: AlertRuleRow[];
  fiatAccounts: PickerOption[];
  investmentAccounts: InvestmentAccountOption[];
  categories: CategoryOption[];
}>) {
  const t = useTranslations("settings.alertRules");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const holdings: HoldingOption[] = investmentAccounts.flatMap((a) =>
    a.holdings.map((h) => ({ id: h.id, ticker: h.ticker, name: h.name, accountName: a.name, targetPct: h.targetPct }))
  );

  function handleToggle(id: string, active: boolean) {
    startTransition(async () => {
      await toggleAlertRuleActive(id, active);
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    return async () => {
      await deleteAlertRule(id);
      router.refresh();
    };
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-2">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">{t("title")}</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">{t("subtitle")}</p>
        </div>
        <AlertRuleDialog fiatAccounts={fiatAccounts} investmentAccounts={investmentAccounts} holdings={holdings} categories={categories} />
      </div>

      {rules.length === 0 ? (
        <EmptyState icon={BellRing} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
          {rules.map((rule) => (
            <div key={rule.id} className="px-5 py-3.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-[var(--foreground)]">{ruleLabel(rule, t)}</p>
                  <span
                    className={`text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded ${
                      rule.active
                        ? "bg-[var(--positive)]/15 text-[var(--positive)]"
                        : "bg-[var(--muted)]/15 text-[var(--muted)]"
                    }`}
                  >
                    {rule.active ? t("statusActive") : t("statusPaused")}
                  </span>
                </div>
                {rule.message && <p className="text-xs text-[var(--muted)] mt-0.5">{rule.message}</p>}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={rule.active ? t("pause") : t("resume")}
                  onClick={() => handleToggle(rule.id, !rule.active)}
                  disabled={pending}
                >
                  {rule.active ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
                </Button>
                <AlertRuleDialog
                  rule={rule}
                  fiatAccounts={fiatAccounts}
                  investmentAccounts={investmentAccounts}
                  holdings={holdings}
                  categories={categories}
                />
                <DeleteButton
                  iconOnly
                  label={t("delete")}
                  description={t("deleteDescription")}
                  onDelete={handleDelete(rule.id)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
