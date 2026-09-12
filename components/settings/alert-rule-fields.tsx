"use client";

/**
 * The form fields each AlertRule kind needs, and the switch that picks between
 * them. Split out of alert-rules-section.tsx at v2.10.5, which was 810 lines
 * and had been declined for splitting three audits running because nothing
 * could catch a prop-wiring mistake here - a threshold rendered from the wrong
 * field looks entirely normal and writes the wrong number.
 *
 * That objection ended when the rendering harness landed: the split is
 * guarded by __tests__/alert-rules-section.test.tsx, whose assertions fail
 * when a field is read from the wrong place.
 *
 * Four of the eight kinds share balanceThresholdCents rather than each getting
 * their own column - see schema.prisma's AlertRule comment for why the names
 * stayed "balance"-flavoured.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Input, Select } from "@/components/ui/input";
import { centsToEuro } from "@/lib/utils/format";
import type { AlertRuleKind, AlertRuleRow } from "@/lib/domain/alert-rule-labels";

type PickerOption = { id: string; name: string };
type CategoryOption = { id: string; name: string; budgetCents: bigint | null };
type InvestmentAccountOption = {
  id: string;
  name: string;
  holdings: { id: string; ticker: string; name: string | null; targetPct: number | null }[];
};
// ticker is a real ISIN (see CLAUDE.md's "Automatic categorization"), never
// shown directly - name is the friendly display value everywhere else in
// this app already shows a holding (holdings-table.tsx, investment-tab.tsx),
// falling back to ticker only when no name was ever set on the holding.
// targetPct is only used to filter this same flattened list down to
// REBALANCING_DRIFT-eligible holdings below (see driftEligibleHoldings) -
// HOLDING_PRICE's own picker ignores it, any holding is a valid target there.
type HoldingOption = { id: string; ticker: string; name: string | null; accountName: string; targetPct: number | null };

// ACCOUNT_BALANCE and INVESTMENT_VALUE are structurally identical fields (an
// account + a cents threshold) - only the eligible account list differs,
// passed in by the caller. See schema.prisma's AlertRule comment for why
// they share storage instead of each kind getting its own pair of columns.

export type { PickerOption, CategoryOption, InvestmentAccountOption, HoldingOption };

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

// REBALANCING_DRIFT: same picker shape as HoldingPriceFields (a specific
// position from the flattened list), but the threshold is drift points
// (gainThresholdPct, like UNREALIZED_GAIN's PERCENT branch) rather than a
// euro price - and only holdings with a targetPct already set are eligible,
// enforced both here (picker content) and server-side
// (assertHoldingHasTarget in lib/actions/alert-rules.ts).
function RebalancingDriftFields({
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
          label={t("driftThresholdField")}
          name="gainThresholdPct"
          type="text"
          inputMode="decimal"
          defaultValue={rule?.gainThresholdPct ?? ""}
          required
        />
      </>
    );
  }
  if (noEligibleHoldings) {
    return <p className="text-xs text-[var(--muted)]">{t("noEligibleDriftHoldings")}</p>;
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
      <Input label={t("driftThresholdField")} name="gainThresholdPct" type="text" inputMode="decimal" required />
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

// NEW_TRANSACTION: the only kind where every field is optional - an empty
// account picker means "every account" (same "null is valid input"
// precedent as UnrealizedGainFields' gainAllAccounts option above), an empty
// threshold means "no minimum amount," an empty direction means "debits and
// credits both." Never blocked from submitting even with zero accounts
// (unlike every other kind's noEligibleX guard) - "notify me on any new
// transaction anywhere" needs no account to exist yet at rule-creation time.
type DirectionFormValue = "" | "DEBIT" | "CREDIT";

function NewTransactionFields({
  isEdit,
  rule,
  accounts,
  t,
}: Readonly<{
  isEdit: boolean;
  rule?: AlertRuleRow;
  accounts: PickerOption[];
  t: ReturnType<typeof useTranslations>;
}>) {
  const [direction, setDirection] = useState<DirectionFormValue>(rule?.transactionDirection ?? "");

  if (isEdit) {
    return (
      <>
        <p className="text-sm text-[var(--foreground)]">{rule?.account?.name ?? t("newTransactionAllAccounts")}</p>
        <Input
          label={t("minimumAmountField")}
          name="balanceThreshold"
          type="text"
          inputMode="decimal"
          defaultValue={rule?.balanceThresholdCents !== null ? centsToEuro(rule!.balanceThresholdCents!) : ""}
        />
        <Select
          label={t("directionField")}
          name="transactionDirection"
          value={direction}
          onChange={(e) => setDirection(e.target.value as DirectionFormValue)}
          options={[
            { value: "", label: t("directionBoth") },
            { value: "DEBIT", label: t("directionDebit") },
            { value: "CREDIT", label: t("directionCredit") },
          ]}
        />
      </>
    );
  }
  return (
    <>
      <Select
        label={t("accountField")}
        name="accountId"
        options={[{ value: "", label: t("newTransactionAllAccounts") }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
        defaultValue=""
      />
      <Input label={t("minimumAmountField")} name="balanceThreshold" type="text" inputMode="decimal" />
      <Select
        label={t("directionField")}
        name="transactionDirection"
        value={direction}
        onChange={(e) => setDirection(e.target.value as DirectionFormValue)}
        options={[
          { value: "", label: t("directionBoth") },
          { value: "DEBIT", label: t("directionDebit") },
          { value: "CREDIT", label: t("directionCredit") },
        ]}
      />
    </>
  );
}

// Renders the field group for the currently selected kind - kept as its own
// function (not inlined into AlertRuleDialog) to stay under the sonarjs
// cognitive-complexity gate now that there are 6 kinds instead of 2.
export function KindFields({
  kind,
  isEdit,
  rule,
  fiatAccounts,
  investmentAccounts,
  allAccounts,
  holdings,
  driftEligibleHoldings,
  categories,
  t,
}: Readonly<{
  kind: AlertRuleKind;
  isEdit: boolean;
  rule?: AlertRuleRow;
  fiatAccounts: PickerOption[];
  investmentAccounts: InvestmentAccountOption[];
  allAccounts: PickerOption[];
  holdings: HoldingOption[];
  driftEligibleHoldings: HoldingOption[];
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
    case "REBALANCING_DRIFT":
      return (
        <RebalancingDriftFields
          isEdit={isEdit}
          rule={rule}
          holdings={driftEligibleHoldings}
          noEligibleHoldings={!isEdit && driftEligibleHoldings.length === 0}
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
    case "NEW_TRANSACTION":
      return <NewTransactionFields isEdit={isEdit} rule={rule} accounts={allAccounts} t={t} />;
    default:
      return null;
  }
}
