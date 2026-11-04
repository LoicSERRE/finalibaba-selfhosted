import { getTranslations } from "next-intl/server";
import { partsPct } from "@/lib/domain/company";
import type { CompanyPageAssociate } from "@/lib/services/companies-read";
import { CapTableDialog } from "@/components/companies/cap-table-dialog";

// One colour per associate in the parts bar - distinct in lightness, not hue
// alone, and repeating past six.
const ASSOCIATE_COLORS = ["#6366f1", "#f59e0b", "#14b8a6", "#ec4899", "#a1665e", "#0ea5e9"];

/**
 * The company page's cap table: who holds how many parts, as a bar and a
 * list. The manager also sees who has not accepted their link yet, and the
 * editor (CapTableDialog); an associate reads it.
 */
export async function CompanyAssociatesCard({
  companyId,
  totalParts,
  associates,
  isManager,
  locale,
}: Readonly<{
  companyId: string;
  totalParts: number;
  associates: CompanyPageAssociate[];
  isManager: boolean;
  locale: string;
}>) {
  const t = await getTranslations("companies.page");
  const color = (i: number) => ASSOCIATE_COLORS[i % ASSOCIATE_COLORS.length];
  const barLabel = [
    t("associatesBar"),
    associates.map((a) => t("associateShare", { name: a.name, pct: partsPct(a.parts, totalParts) })).join(", "),
  ].join(" : ");

  return (
    <section className="lg:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3" aria-labelledby="company-associates">
      <div className="flex items-center justify-between gap-2">
        <h2 id="company-associates" className="text-sm font-medium text-[var(--foreground)]">{t("associates")}</h2>
        {isManager && <CapTableDialog companyId={companyId} totalParts={totalParts} associates={associates} />}
      </div>
      <div className="flex h-2.5 rounded-full overflow-hidden" role="img" aria-label={barLabel}>
        {associates.map((a, i) => (
          <div key={a.id} style={{ width: `${partsPct(a.parts, totalParts)}%`, background: color(i) }} />
        ))}
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {associates.map((a, i) => (
          <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <span className="flex items-center gap-2 min-w-0">
              <span aria-hidden="true" className="size-2.5 rounded-full shrink-0" style={{ background: color(i) }} />
              <span className="break-words text-[var(--foreground)]">
                {a.name}
                {a.isViewer && <span className="text-[var(--muted)]"> ({t("you")})</span>}
                {isManager && a.link === "pending" && <span className="text-xs text-[var(--warning)]"> · {t("invitationSent")}</span>}
              </span>
            </span>
            <span className="text-xs text-[var(--muted)] shrink-0 tabular-nums">
              {t("partsAndPct", { parts: a.parts.toLocaleString(locale), pct: partsPct(a.parts, totalParts) })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
