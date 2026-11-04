export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { getViewer } from "@/lib/auth-context";
import { assertId, isInvalidActionInput } from "@/lib/domain/action-input";
import { partsPct } from "@/lib/domain/company";
import { loadCompanyPage } from "@/lib/services/companies-read";
import { formatCurrency, localeToIntl } from "@/lib/utils/format";
import { ALLOCATION_CATEGORY_COLORS } from "@/lib/utils/palette";
import { NetWorthChart } from "@/components/shared/net-worth-chart";
import { AssetAllocationChart, type AllocationSlice } from "@/components/shared/asset-allocation-chart";
import { AttachAccountsDialog } from "@/components/companies/attach-accounts-dialog";
import { CompanyAssociatesCard } from "@/components/companies/company-associates-card";
import { CompanySettingsDialog } from "@/components/companies/company-settings-dialog";
import { LeaveCompanyButton, OpenAsPortfolioButton } from "@/components/companies/company-view-actions";

/**
 * A company's own page (dev-docs/companies.md, interface "C"): its value, the
 * viewer's share, its history and allocation, its accounts and its cap table.
 * The manager edits it; an associate who accepted their link reads it; anyone
 * else gets notFound() - the same answer as a company that does not exist.
 */
export default async function CompanyPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id: rawId } = await params;
  let id: string;
  try {
    id = assertId(rawId);
  } catch (e) {
    if (isInvalidActionInput(e)) notFound();
    throw e;
  }

  const [viewer, locale, t, tAlloc] = await Promise.all([
    getViewer(),
    getLocale(),
    getTranslations("companies"),
    getTranslations("allocation"),
  ]);
  const data = await loadCompanyPage(viewer.id, id, localeToIntl(locale), new Date());
  if (!data) notFound();

  const { company, role, associates, result } = data;
  const isManager = role === "manager";
  const viewerAssociate = associates.find((a) => a.isViewer);
  const allocation: AllocationSlice[] = (
    ["cash", "savings", "investments", "crypto", "realEstate", "auto"] as const
  ).map((key) => ({ name: tAlloc(key), value: result.allocationRaw[key], color: ALLOCATION_CATEGORY_COLORS[key] }));
  const accounts = result.institutions.flatMap((inst) =>
    inst.accounts.map((a) => ({ ...a, institution: inst.name })),
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="space-y-2">
        <Link
          href="/accounts"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)] min-h-11 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          {t("page.back")}
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-[var(--foreground)] break-words">{company.name}</h1>
            <p className="text-sm text-[var(--muted)] mt-1">
              {t("page.subtitle", {
                kind: t(`kind.${company.kind}`),
                regime: t(`regime.${company.taxRegime}`),
                parts: company.totalParts.toLocaleString(locale),
              })}
              {" · "}
              {isManager ? t("page.youManage") : t("page.youAreAssociate")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <OpenAsPortfolioButton companyId={company.id} />
            {isManager && <CompanySettingsDialog company={company} associates={associates} />}
            {!isManager && viewerAssociate && <LeaveCompanyButton associateId={viewerAssociate.id} companyName={company.name} />}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-xs text-[var(--muted)]">{t("page.anr")}</p>
          <p className="text-2xl font-semibold tabular-nums text-[var(--accent)] mt-1 amount">{formatCurrency(result.netWorth, 0)}</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          {data.partsHeld > 0 ? (
            <>
              <p className="text-xs text-[var(--muted)]">{t("page.yourShareLabel", { pct: partsPct(data.partsHeld, company.totalParts) })}</p>
              <p className="text-2xl font-semibold tabular-nums text-[var(--foreground)] mt-1 amount">{formatCurrency(data.shareCents, 0)}</p>
              <p className="text-xs text-[var(--muted)] mt-1">{t("page.yourShareHint")}</p>
            </>
          ) : (
            <p className="text-sm text-[var(--muted)]">{t("page.noShare")}</p>
          )}
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-xs text-[var(--muted)]">{t("page.partValue")}</p>
          <p className="text-2xl font-semibold tabular-nums text-[var(--foreground)] mt-1 amount">{formatCurrency(data.partValueCents, 2)}</p>
        </div>
      </div>

      {result.history.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
            <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-4">{t("page.history")}</h2>
            <NetWorthChart data={result.history} />
          </div>
          <div className="lg:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
            <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-4">{t("page.allocation")}</h2>
            <AssetAllocationChart data={allocation} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <section className="lg:col-span-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl" aria-labelledby="company-accounts">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--border)]">
            <h2 id="company-accounts" className="text-sm font-medium text-[var(--foreground)]">{t("page.accounts")}</h2>
            {isManager && data.attachable && <AttachAccountsDialog companyId={company.id} attachable={data.attachable} />}
          </div>
          {accounts.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[var(--muted)]">{t("page.noAccounts")}</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {accounts.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/accounts/${a.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 min-h-11 hover:bg-[var(--surface-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
                  >
                    <span className="min-w-0 break-words text-sm text-[var(--foreground)]">
                      {a.name}
                      {a.institution && <span className="ml-2 text-xs text-[var(--muted)]">{a.institution}</span>}
                    </span>
                    <span className={`text-sm tabular-nums shrink-0 amount ${a.value < BigInt(0) ? "text-[var(--negative-text)]" : "text-[var(--foreground)]"}`}>
                      {formatCurrency(a.value, 0)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <CompanyAssociatesCard
          companyId={company.id}
          totalParts={company.totalParts}
          associates={associates}
          isManager={isManager}
          locale={locale}
        />
      </div>
    </div>
  );
}
