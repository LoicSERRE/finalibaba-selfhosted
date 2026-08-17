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

type AlertRuleRow = {
  id: string;
  kind: "ACCOUNT_BALANCE" | "BUDGET_OVERRUN";
  active: boolean;
  message: string | null;
  account: { id: string; name: string } | null;
  balanceThresholdCents: bigint | null;
  category: { id: string; name: string; budgetCents: bigint | null } | null;
};

type PickerOption = { id: string; name: string };
type CategoryOption = { id: string; name: string; budgetCents: bigint | null };

function AccountBalanceFields({
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
    return <p className="text-xs text-[var(--muted)]">{t("noEligibleAccounts")}</p>;
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

function AlertRuleDialog({
  rule,
  accounts,
  categories,
}: Readonly<{
  rule?: AlertRuleRow;
  accounts: PickerOption[];
  categories: CategoryOption[];
}>) {
  const isEdit = !!rule;
  const t = useTranslations("settings.alertRules");
  const tc = useTranslations("common");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<"ACCOUNT_BALANCE" | "BUDGET_OVERRUN">(rule?.kind ?? "ACCOUNT_BALANCE");

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

  const noEligibleAccounts = !isEdit && kind === "ACCOUNT_BALANCE" && accounts.length === 0;
  const noEligibleCategories = !isEdit && kind === "BUDGET_OVERRUN" && categories.length === 0;

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
          onChange={(e) => setKind(e.target.value as "ACCOUNT_BALANCE" | "BUDGET_OVERRUN")}
          options={[
            { value: "ACCOUNT_BALANCE", label: t("kindAccountBalance") },
            { value: "BUDGET_OVERRUN", label: t("kindBudgetOverrun") },
          ]}
        />

        {kind === "ACCOUNT_BALANCE" && (
          <AccountBalanceFields
            isEdit={isEdit}
            rule={rule}
            accounts={accounts}
            noEligibleAccounts={noEligibleAccounts}
            t={t}
          />
        )}

        {kind === "BUDGET_OVERRUN" && (
          <BudgetOverrunFields
            isEdit={isEdit}
            rule={rule}
            categories={categories}
            noEligibleCategories={noEligibleCategories}
            t={t}
          />
        )}

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
          <Button
            type="submit"
            disabled={pending || noEligibleAccounts || noEligibleCategories}
          >
            {pending ? (isEdit ? t("saving") : t("creating")) : isEdit ? t("save") : t("confirm")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function AlertRulesSection({
  rules,
  accounts,
  categories,
}: Readonly<{
  rules: AlertRuleRow[];
  accounts: PickerOption[];
  categories: CategoryOption[];
}>) {
  const t = useTranslations("settings.alertRules");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">{t("title")}</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">{t("subtitle")}</p>
        </div>
        <AlertRuleDialog accounts={accounts} categories={categories} />
      </div>

      {rules.length === 0 ? (
        <EmptyState icon={BellRing} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
          {rules.map((rule) => (
            <div key={rule.id} className="px-5 py-3.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-[var(--foreground)]">
                    {rule.kind === "ACCOUNT_BALANCE"
                      ? t("ruleAccountBalance", {
                          account: rule.account?.name ?? "?",
                          threshold: formatCurrency(rule.balanceThresholdCents ?? BigInt(0)),
                        })
                      : t("ruleBudgetOverrun", { category: rule.category?.name ?? "?" })}
                  </p>
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
                <Button variant="outline" size="sm" onClick={() => handleToggle(rule.id, !rule.active)} disabled={pending}>
                  {rule.active ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
                  {rule.active ? t("pause") : t("resume")}
                </Button>
                <AlertRuleDialog rule={rule} accounts={accounts} categories={categories} />
                <DeleteButton label={t("delete")} description={t("deleteDescription")} onDelete={handleDelete(rule.id)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
