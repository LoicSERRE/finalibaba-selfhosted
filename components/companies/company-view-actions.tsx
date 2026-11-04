"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LayoutDashboard } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/shared/delete-button";
import { respondToCompanyLink, setViewingCompany } from "@/lib/actions/companies";

/** Shows the whole app (budgets, transactions, analytics) on this company. */
export function OpenAsPortfolioButton({ companyId }: Readonly<{ companyId: string }>) {
  const t = useTranslations("companies.page");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      title={t("openAsPortfolioHint")}
      onClick={() =>
        startTransition(async () => {
          await setViewingCompany(companyId);
          router.push("/");
        })
      }
    >
      <LayoutDashboard size={14} aria-hidden="true" />
      {t("openAsPortfolio")}
    </Button>
  );
}

/**
 * The banner of the company scope: which company the pages show, and the way
 * back - the scope is app-wide, and an account added here lands in the
 * company, so it must never be easy to forget you are in it.
 */
export function ViewingCompanyBanner({ name, readOnly }: Readonly<{ name: string; readOnly: boolean }>) {
  const t = useTranslations("companies");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-4 py-2.5 text-sm">
      <span className="text-[var(--foreground)]">
        {readOnly ? t("viewingBannerReadOnly", { name }) : t("viewingBanner", { name })}
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await setViewingCompany(null);
            router.refresh();
          })
        }
        className="min-h-11 px-2 text-sm text-[var(--accent-text)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
      >
        {t("backToMine")}
      </button>
    </div>
  );
}

/** An associate stepping out: unlinks their row, keeps their parts recorded. */
export function LeaveCompanyButton({ associateId, companyName }: Readonly<{ associateId: string; companyName: string }>) {
  const t = useTranslations("companies.page");
  const router = useRouter();
  return (
    <DeleteButton
      label={t("leave")}
      description={t("leaveConfirm", { name: companyName })}
      onDelete={async () => {
        await respondToCompanyLink(associateId, false);
        router.push("/accounts");
      }}
    />
  );
}
