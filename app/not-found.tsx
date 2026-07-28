import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("common");
  return (
    <div className="flex flex-col items-center justify-center min-h-64 gap-3">
      <h1 className="text-4xl font-semibold text-[var(--muted)]">404</h1>
      <p className="text-sm text-[var(--muted)]">{t("notFoundTitle")}</p>
      <Link href="/" className="text-sm text-[var(--accent-text)] underline underline-offset-2">
        {t("backToDashboard")}
      </Link>
    </div>
  );
}
