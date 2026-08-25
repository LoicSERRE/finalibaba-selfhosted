"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Plus, Pencil, Pause, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { DeleteButton } from "@/components/shared/delete-button";
import { EmptyState } from "@/components/shared/empty-state";
import { createAlertRule, updateAlertRule, deleteAlertRule, toggleAlertRuleActive } from "@/lib/actions/alert-rules";
import { formatCurrency, centsToEuro } from "@/lib/utils/format";

type AlertRuleKind = "ACCOUNT_BALANCE" | "BUDGET_OVERRUN" | "ACCOUNT_OVERDRAFT" | "INVESTMENT_VALUE" | "HOLDING_PRICE" | "UNREALIZED_GAIN";

type AlertRuleRow = {
  id: string;
  kind: AlertRuleKind;
  active: boolean;
  message: string | null;
  account: { id: string; name: string } | null;
  balanceThresholdCents: bigint | null;
  category: { id: string; name: string; budgetCents: bigint | null } | null;
  holding: { id: string; ticker: string; name: string | null; account: { id: string; name: string } } | null;
  gainUnit: "PERCENT" | "AMOUNT" | null;
  gainThresholdPct: number | null;
};

type PickerOption = { id: string; name: string };
type CategoryOption = { id: string; name: string; budgetCents: bigint | null };
type InvestmentAccountOption = { id: string; name: string; holdings: { id: string; ticker: string; name: string | null }[] };
// ticker is a real ISIN (see CLAUDE.md's "Automatic categorization"), never
// shown directly - name is the friendly display value everywhere else in
// this app already shows a holding (holdings-table.tsx, investment-tab.tsx),
// falling back to ticker only when no name was ever set on the holding.
type HoldingOption = { id: string; ticker: string; name: string | null; accountName: string };

// ACCOUNT_BALANCE and INVESTMENT_VALUE are structurally identical fields (an
// account + a cents threshold) - only the eligible account list differs,
// passed in by the caller. See schema.prisma's AlertRule comment for why
// they share storage instead of each kind getting its own pair of columns.
function AccountThresholdFields({
  isEdit,
  rule,
  accounts,
  noEligibleAccounts,
  noEligibleMessage,
  t,
}: Readonly<{
  isEdit: boolean;
  rule?: AlertRuleRow;
  accounts: PickerOption[];
  noEligibleAccounts: boolean;
  noEligibleMessage: string;
  t: ReturnType<typeof useTranslations>;
}>) {
  if (isEdit) {
    return (
      <>
        <p className="text-sm text-[var(--foreground)]">{rule?.account?.name}</p>
        <Input
          label={t("thresholdField")}
          name="balanceThreshold"
          type="text"
          inputMode="decimal"
          defaultValue={rule?.balanceThresholdCents !== null ? centsToEuro(rule!.balanceThresholdCents!) : ""}
          required
        />
      </>
    );
  }
  if (noEligibleAccounts) {
    return <p className="text-xs text-[var(--muted)]">{noEligibleMessage}</p>;
  }
  return (
    <>
      <Select
        label={t("accountField")}
        name="accountId"
        options={[
          { value: "", label: t("accountPlaceholder"), disabled: true },
          ...accounts.map((a) => ({ value: a.id, label: a.name })),
        ]}
        defaultValue=""
        required
      />
      <Input label={t("thresholdField")} name="balanceThreshold" type="text" inputMode="decimal" required />
    </>
  );
}

// ACCOUNT_OVERDRAFT: just an account picker, no threshold input - always
// fixed at 0 (see createAlertRule), so there's nothing for the user to type.
function AccountOnlyFields({
  isEdit,
  rule,
  accounts,
  noEligibleAccounts,
  t,
}: Readonly<{
  isEdit: boolean;
  rule?: AlertRuleRow;
  accounts: PickerOption[];
  noEligibleAccounts: boolean;
  t: ReturnType<typeof useTranslations>;
}>) {
  if (isEdit) {
    return <p className="text-sm text-[var(--foreground)]">{rule?.account?.name}</p>;
  }
  if (noEligibleAccounts) {
    return <p className="text-xs text-[var(--muted)]">{t("noEligibleAccounts")}</p>;
  }
  return (
    <Select
      label={t("accountField")}
      name="accountId"
      options={[
        { value: "", label: t("accountPlaceholder"), disabled: true },
        ...accounts.map((a) => ({ value: a.id, label: a.name })),
      ]}
      defaultValue=""
      required
    />
  );
}

// HOLDING_PRICE: a specific position (flattened from every investment/crypto
// account's holdings, see AlertRulesSection below) + a cents threshold.
function HoldingPriceFields({
  isEdit,
  rule,
  holdings,
  noEligibleHoldings,
  t,
}: Readonly<{
  isEdit: boolean;
  rule?: AlertRuleRow;
  holdings: HoldingOption[];
  noEligibleHoldings: boolean;
  t: ReturnType<typeof useTranslations>;
}>) {
  if (isEdit) {
    return (
      <>
        <p className="text-sm text-[var(--foreground)]">
          {rule?.holding?.name ?? rule?.holding?.ticker} · {rule?.holding?.account.name}
        </p>
        <Input
          label={t("thresholdField")}
          name="balanceThreshold"
          type="text"
          inputMode="decimal"
          defaultValue={rule?.balanceThresholdCents !== null ? centsToEuro(rule!.balanceThresholdCents!) : ""}
          required
        />
      </>
    );
  }
  if (noEligibleHoldings) {
    return <p className="text-xs text-[var(--muted)]">{t("noEligibleHoldings")}</p>;
  }
  return (
    <>
      <Select
        label={t("holdingField")}
        name="holdingId"
        options={[
          { value: "", label: t("holdingPlaceholder"), disabled: true },
          ...holdings.map((h) => ({ value: h.id, label: `${h.name ?? h.ticker} · ${h.accountName}` })),
        ]}
        defaultValue=""
        required
      />
      <Input label={t("thresholdField")} name="balanceThreshold" type="text" inputMode="decimal" required />
    </>
  );
}

// UNREALIZED_GAIN: account is optional (blank = every investment/crypto
// account combined, see checkUnrealizedGainRule) and the threshold's unit
// (percent or currency) is picked once at creation and fixed afterward,
// same "immutable, delete and recreate instead" convention as kind/account
// elsewhere in this dialog.
function UnrealizedGainFields({
  isEdit,
  rule,
  accounts,
  t,
}: Readonly<{
  isEdit: boolean;
  rule?: AlertRuleRow;
  accounts: InvestmentAccountOption[];
  t: ReturnType<typeof useTranslations>;
}>) {
  const [unit, setUnit] = useState<"PERCENT" | "AMOUNT">(rule?.gainUnit ?? "PERCENT");

  if (isEdit) {
    return (
      <>
        <p className="text-sm text-[var(--foreground)]">{rule?.account?.name ?? t("gainAllAccounts")}</p>
        {rule?.gainUnit === "PERCENT" ? (
          <Input
            label={t("gainThresholdPctField")}
            name="gainThresholdPct"
            type="text"
            inputMode="decimal"
            defaultValue={rule?.gainThresholdPct ?? ""}
            required
          />
        ) : (
          <Input
            label={t("thresholdField")}
            name="balanceThreshold"
            type="text"
            inputMode="decimal"
            defaultValue={rule?.balanceThresholdCents !== null ? centsToEuro(rule!.balanceThresholdCents!) : ""}
            required
          />
        )}
      </>
    );
  }
  return (
    <>
      <Select
        label={t("accountField")}
        name="accountId"
        options={[{ value: "", label: t("gainAllAccounts") }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
        defaultValue=""
      />
      <Select
        label={t("gainUnitField")}
        name="gainUnit"
        value={unit}
        onChange={(e) => setUnit(e.target.value as "PERCENT" | "AMOUNT")}
        options={[
          { value: "PERCENT", label: t("gainUnitPercent") },
          { value: "AMOUNT", label: t("gainUnitAmount") },
        ]}
      />
      {unit === "PERCENT" ? (
        <Input label={t("gainThresholdPctField")} name="gainThresholdPct" type="text" inputMode="decimal" required />
      ) : (
        <Input label={t("thresholdField")} name="balanceThreshold" type="text" inputMode="decimal" required />
      )}
    </>
  );
}

function BudgetOverrunFields({
  isEdit,
  rule,
  categories,
  noEligibleCategories,
  t,
}: Readonly<{
  isEdit: boolean;
  rule?: AlertRuleRow;
  categories: CategoryOption[];
  noEligibleCategories: boolean;
  t: ReturnType<typeof useTranslations>;
}>) {
  if (isEdit) {
    return <p className="text-sm text-[var(--foreground)]">{rule?.category?.name}</p>;
  }
  if (noEligibleCategories) {
    return <p className="text-xs text-[var(--muted)]">{t("noEligibleCategories")}</p>;
  }
  return (
    <Select
      label={t("categoryField")}
      name="categoryId"
      options={[
        { value: "", label: t("categoryPlaceholder"), disabled: true },
        ...categories.map((c) => ({ value: c.id, label: c.name })),
      ]}
      defaultValue=""
      required
    />
  );
}

// Renders the field group for the currently selected kind - kept as its own
// function (not inlined into AlertRuleDialog) to stay under the sonarjs
// cognitive-complexity gate now that there are 6 kinds instead of 2.
function KindFields({
  kind,
  isEdit,
  rule,
  fiatAccounts,
  investmentAccounts,
  holdings,
  categories,
  t,
}: Readonly<{
  kind: AlertRuleKind;
  isEdit: boolean;
  rule?: AlertRuleRow;
  fiatAccounts: PickerOption[];
  investmentAccounts: InvestmentAccountOption[];
  holdings: HoldingOption[];
  categories: CategoryOption[];
  t: ReturnType<typeof useTranslations>;
}>) {
  switch (kind) {
    case "ACCOUNT_BALANCE":
      return (
        <AccountThresholdFields
          isEdit={isEdit}
          rule={rule}
          accounts={fiatAccounts}
          noEligibleAccounts={!isEdit && fiatAccounts.length === 0}
          noEligibleMessage={t("noEligibleAccounts")}
          t={t}
        />
      );
    case "ACCOUNT_OVERDRAFT":
      return (
        <AccountOnlyFields
          isEdit={isEdit}
          rule={rule}
          accounts={fiatAccounts}
          noEligibleAccounts={!isEdit && fiatAccounts.length === 0}
          t={t}
        />
      );
    case "INVESTMENT_VALUE":
      return (
        <AccountThresholdFields
          isEdit={isEdit}
          rule={rule}
          accounts={investmentAccounts}
          noEligibleAccounts={!isEdit && investmentAccounts.length === 0}
          noEligibleMessage={t("noEligibleInvestmentAccounts")}
          t={t}
        />
      );
    case "HOLDING_PRICE":
      return (
        <HoldingPriceFields
          isEdit={isEdit}
          rule={rule}
          holdings={holdings}
          noEligibleHoldings={!isEdit && holdings.length === 0}
          t={t}
        />
      );
    case "UNREALIZED_GAIN":
      return <UnrealizedGainFields isEdit={isEdit} rule={rule} accounts={investmentAccounts} t={t} />;
    case "BUDGET_OVERRUN":
      return (
        <BudgetOverrunFields
          isEdit={isEdit}
          rule={rule}
          categories={categories}
          noEligibleCategories={!isEdit && categories.length === 0}
          t={t}
        />
      );
    default:
      return null;
  }
}

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
            { value: "UNREALIZED_GAIN", label: t("kindUnrealizedGain") },
            { value: "BUDGET_OVERRUN", label: t("kindBudgetOverrun") },
          ]}
        />

        <KindFields
          kind={kind}
          isEdit={isEdit}
          rule={rule}
          fiatAccounts={fiatAccounts}
          investmentAccounts={investmentAccounts}
          holdings={holdings}
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

// Kept separate from the JSX below to stay under the sonarjs
// cognitive-complexity gate now that there are 6 kinds to label.
function ruleLabel(rule: AlertRuleRow, t: ReturnType<typeof useTranslations>): string {
  switch (rule.kind) {
    case "ACCOUNT_BALANCE":
      return t("ruleAccountBalance", {
        account: rule.account?.name ?? "?",
        threshold: formatCurrency(rule.balanceThresholdCents ?? BigInt(0)),
      });
    case "ACCOUNT_OVERDRAFT":
      return t("ruleAccountOverdraft", { account: rule.account?.name ?? "?" });
    case "INVESTMENT_VALUE":
      return t("ruleInvestmentValue", {
        account: rule.account?.name ?? "?",
        threshold: formatCurrency(rule.balanceThresholdCents ?? BigInt(0)),
      });
    case "HOLDING_PRICE":
      return t("ruleHoldingPrice", {
        ticker: rule.holding?.name ?? rule.holding?.ticker ?? "?",
        threshold: formatCurrency(rule.balanceThresholdCents ?? BigInt(0)),
      });
    case "UNREALIZED_GAIN":
      return t("ruleUnrealizedGain", {
        scope: rule.account?.name ?? t("gainAllAccounts"),
        threshold: rule.gainUnit === "PERCENT" ? `${rule.gainThresholdPct ?? 0} %` : formatCurrency(rule.balanceThresholdCents ?? BigInt(0)),
      });
    case "BUDGET_OVERRUN":
    default:
      return t("ruleBudgetOverrun", { category: rule.category?.name ?? "?" });
  }
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
    a.holdings.map((h) => ({ id: h.id, ticker: h.ticker, name: h.name, accountName: a.name }))
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
