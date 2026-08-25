"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Target, Plus, Pencil } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { DeleteButton } from "@/components/shared/delete-button";
import { EmptyState } from "@/components/shared/empty-state";
import { createGoal, updateGoal, deleteGoal } from "@/lib/actions/goals";
import { formatCurrency, centsToEuro, localeToIntl } from "@/lib/utils/format";

type GoalRow = {
  id: string;
  name: string;
  targetCents: bigint;
  targetDate: Date | null;
  accountId: string | null;
  account: { id: string; name: string } | null;
};

type AccountOption = { id: string; name: string; type: string };

// Management UI only - name/target/date/linked account, create/edit/
// delete. No live progress is shown here, matching how AlertRule's own
// live evaluation lives in /api/alerts/check, not in its Settings list -
// progress display stays Analytics-only (components/analytics/goal-and-
// passive-income.tsx), modeled on components/settings/alert-rules-
// section.tsx's dialog/list shape.
function GoalDialog({
  goal,
  accounts,
  ta,
}: Readonly<{
  goal?: GoalRow;
  accounts: AccountOption[];
  ta: (type: string) => string;
}>) {
  const isEdit = !!goal;
  const t = useTranslations("settings.goals");
  const tc = useTranslations("common");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      if (goal) {
        await updateGoal(goal.id, fd);
      } else {
        await createGoal(fd);
      }
      setOpen(false);
      router.refresh();
    });
  }

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
        <Input label={t("nameField")} name="name" type="text" defaultValue={goal?.name ?? ""} placeholder={t("namePlaceholder")} required />
        <Input
          label={t("targetField")}
          name="targetCents"
          type="text"
          inputMode="decimal"
          defaultValue={goal ? centsToEuro(goal.targetCents) : ""}
          required
        />
        <Input
          label={t("targetDateField")}
          name="targetDate"
          type="date"
          defaultValue={goal?.targetDate ? goal.targetDate.toISOString().slice(0, 10) : ""}
        />
        <Select
          label={t("accountField")}
          name="accountId"
          defaultValue={goal?.accountId ?? ""}
          options={[
            { value: "", label: t("accountAllNetWorth") },
            ...accounts.map((a) => ({ value: a.id, label: `${a.name} (${ta(a.type)})` })),
          ]}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {tc("cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? (isEdit ? t("saving") : t("creating")) : isEdit ? t("save") : t("confirm")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function GoalsSection({
  goals,
  accounts,
}: Readonly<{
  goals: GoalRow[];
  accounts: AccountOption[];
}>) {
  const t = useTranslations("settings.goals");
  const ta = useTranslations("accountTypes");
  const router = useRouter();
  const intlLocale = localeToIntl(useLocale());

  function handleDelete(id: string) {
    return async () => {
      await deleteGoal(id);
      router.refresh();
    };
  }

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-x-3 gap-y-2">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">{t("title")}</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">{t("subtitle")}</p>
        </div>
        <GoalDialog accounts={accounts} ta={ta} />
      </div>

      {goals.length === 0 ? (
        <EmptyState icon={Target} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
          {goals.map((goal) => (
            <div key={goal.id} className="px-5 py-3.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">{goal.name}</p>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  {formatCurrency(goal.targetCents, 0)} · {goal.account ? goal.account.name : t("accountAllNetWorth")}
                  {goal.targetDate && ` · ${new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", year: "numeric" }).format(goal.targetDate)}`}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <GoalDialog goal={goal} accounts={accounts} ta={ta} />
                <DeleteButton iconOnly label={t("delete")} description={t("deleteDescription")} onDelete={handleDelete(goal.id)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
