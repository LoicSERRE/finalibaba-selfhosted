import Link from "next/link";
import { getTranslations } from "next-intl/server";

const linkClass = "text-[var(--accent)] underline underline-offset-2";

export async function DashboardEmptyState() {
  const t = await getTranslations("dashboard");

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-10 text-center">
      <p className="text-sm text-[var(--muted)]">
        {t("emptyStateIntro")}{" "}
        <Link href="/settings" className={linkClass}>
          {t("emptyStateSettings")}
        </Link>
        {t("emptyStateConnector")}{" "}
        <Link href="/accounts" className={linkClass}>
          {t("emptyStateAccounts")}
        </Link>
      </p>
    </div>
  );
}
