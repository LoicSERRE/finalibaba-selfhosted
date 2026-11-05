import { getTranslations } from "next-intl/server";
import { formatDateShort } from "@/lib/utils/format";
import type { CapTableHistoryEntry } from "@/lib/services/companies-read";
import { DeleteVersionButton } from "@/components/companies/delete-version-button";

/**
 * Every dated cap table of the company, newest first (step 5): who held what
 * from when, and why it changed. Each past day is valued with the version in
 * force that day. Shown once there is more than the first one.
 */
export async function CapTableHistoryCard({
  companyId,
  versions,
  isManager,
  intlLocale,
}: Readonly<{ companyId: string; versions: CapTableHistoryEntry[]; isManager: boolean; intlLocale: string }>) {
  if (versions.length < 2) return null;
  const t = await getTranslations("companies.history");
  const holderText = (h: CapTableHistoryEntry["holders"][number]) =>
    [
      h.parts > 0 ? t("parts", { count: h.parts }) : null,
      h.usufructParts > 0 ? t("usufruct", { count: h.usufructParts }) : null,
      h.bareParts > 0 ? t("bare", { count: h.bareParts }) : null,
    ]
      .filter(Boolean)
      .join(", ");

  return (
    <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-2" aria-labelledby="cap-table-history">
      <h2 id="cap-table-history" className="text-sm font-medium text-[var(--foreground)]">{t("title")}</h2>
      <p className="text-xs text-[var(--muted)]">{t("hint")}</p>
      <ol className="divide-y divide-[var(--border)]">
        {versions.map((v) => (
          <li key={v.id} className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0 text-sm">
              <p className="text-[var(--foreground)]">
                <span className="tabular-nums">
                  {v.fromOrigin ? t("origin") : formatDateShort(new Date(`${v.effectiveFrom}T12:00:00.000Z`), intlLocale)}
                </span>
                {" · "}
                {t(`kind.${v.kind}`)}
                {v.isCurrent && (
                  <span className="ml-2 text-xs rounded-full px-2 py-0.5 bg-[var(--surface-elevated)] text-[var(--muted)]">{t("current")}</span>
                )}
              </p>
              <p className="text-xs text-[var(--muted)] break-words">
                {v.holders.map((h) => `${h.name} : ${holderText(h)}`).join(" · ")}
                {" - "}
                {t("total", { count: v.totalParts })}
              </p>
            </div>
            {isManager && <DeleteVersionButton companyId={companyId} versionId={v.id} />}
          </li>
        ))}
      </ol>
    </section>
  );
}
