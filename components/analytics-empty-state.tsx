import Link from "next/link";
import { getTranslations } from "next-intl/server";

const linkClass = "text-[var(--accent)] underline underline-offset-2";

export async function AnalyticsEmptyState() {
  const t = await getTranslations("analytics");

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-10 text-center">
      <p className="text-sm text-[var(--muted)]">
        {t("noDataIntro")}{" "}
        <Link href="/accounts" className={linkClass}>
          {t("noDataLink")}
        </Link>
      </p>
    </div>
  );
}
