export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db/prisma";
import { getViewContext } from "@/lib/auth-context";
import { localeToIntl } from "@/lib/utils/format";
import { type AllocationSlice } from "@/components/shared/asset-allocation-chart";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { computePortfolio } from "@/lib/services/net-worth";
import { withCompaniesGroup } from "@/lib/domain/company";
import { ViewingCompanyBanner } from "@/components/companies/company-view-actions";
import { ALLOCATION_CATEGORY_COLORS } from "@/lib/utils/palette";
import { getTranslations, getLocale } from "next-intl/server";
import { upcomingOccurrences } from "@/lib/domain/upcoming";
import { UpcomingCard } from "@/components/dashboard/upcoming-card";
import { cookies } from "next/headers";
import { FirstRunChecklist } from "@/components/dashboard/first-run-checklist";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { FIRST_RUN_COOKIE, checklistVariant, firstRunSteps } from "@/lib/domain/first-run";
import { loadFirstRunFacts } from "@/lib/services/first-run";

export default async function DashboardPage() {
  // Every query on this page is scoped to the accounts this viewer may see
  // (their own plus co-owned ones). In mono mode that resolves to the
  // instance owner, i.e. everything - identical to pre-v2.0 behavior.
  const { viewer, ownerId, accountIds, readOnly, companyId } = await getViewContext();

  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  // A person's portfolio carries their company shares; a company's own scope
  // carries none (a company does not hold companies here).
  const { input, result } = await computePortfolio({
    accountIds,
    shareholderId: companyId ? null : ownerId,
    intlLocale: localeToIntl(locale),
    now: new Date(),
  });
  const series = await prisma.recurringTransaction.findMany({
    where: { accountId: { in: accountIds }, active: true, dismissedAt: null },
    select: { id: true, label: true, amountCents: true, amountVaries: true, frequency: true, intervalCount: true, anchorDate: true },
  });
  const upcoming = upcomingOccurrences(series, new Date());


  const {
    hasAccounts,
    netWorth,
    grossAssets,
    totalPassif,
    totalLiabilities,
    totalLatentTax,
    allocationRaw,
    institutions,
    history,
    allocationHistory,
    delta30,
  } = result;

  // Not grossAssets > 0 - a LOAN-only portfolio has real data (a mortgage,
  // real payments) but zero gross assets by design (pure liability, no
  // asset counterpart, see lib/dashboard.ts). Gating on grossAssets showed
  // the "add your first account" empty state to a user who'd already added
  // one.
  const hasData = hasAccounts;

  // First-run checklist (v2.17): the viewer's own setup only, never on a
  // granted portfolio. With no account it replaces the empty dashboard;
  // otherwise it sits on top until done or hidden on this device.
  // Nor on a company's scope: the checklist is about setting up your own.
  const steps = readOnly || companyId ? null : firstRunSteps(await loadFirstRunFacts(viewer.id, accountIds));
  const variant = checklistVariant(steps, hasAccounts, (await cookies()).get(FIRST_RUN_COOKIE)?.value === "1");

  const allocationSlices: AllocationSlice[] = [
    { name: t("allocation.cash"), value: allocationRaw.cash, color: ALLOCATION_CATEGORY_COLORS.cash },
    { name: t("allocation.savings"), value: allocationRaw.savings, color: ALLOCATION_CATEGORY_COLORS.savings },
    { name: t("allocation.investments"), value: allocationRaw.investments, color: ALLOCATION_CATEGORY_COLORS.investments },
    { name: t("allocation.crypto"), value: allocationRaw.crypto, color: ALLOCATION_CATEGORY_COLORS.crypto },
    { name: t("allocation.realEstate"), value: allocationRaw.realEstate, color: ALLOCATION_CATEGORY_COLORS.realEstate },
    { name: t("allocation.auto"), value: allocationRaw.auto, color: ALLOCATION_CATEGORY_COLORS.auto },
    { name: t("allocation.companies"), value: allocationRaw.companies, color: ALLOCATION_CATEGORY_COLORS.companies },
  ];

  const scopedCompany = companyId
    ? await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } })
    : null;

  return (
    <>
      {/* The company scope is app-wide: say so where the figures are. */}
      {scopedCompany && (
        <div className="max-w-4xl mx-auto mb-6">
          <ViewingCompanyBanner name={scopedCompany.name} readOnly={readOnly} />
        </div>
      )}
      <DashboardView
        t={t}
        netWorth={netWorth}
        grossAssets={grossAssets}
        totalPassif={totalPassif}
        totalLiabilities={totalLiabilities}
        totalLatentTax={totalLatentTax}
        delta30={delta30}
        hasData={hasData}
        history={history}
        allocationSlices={allocationSlices}
        allocationHistory={allocationHistory}
        institutions={withCompaniesGroup(institutions, input.companyShares, t("companies.sectionTitle"))}
        upcoming={
          <>
            {variant === "compact" && steps && <FirstRunChecklist t={t} steps={steps} variant="compact" />}
            <UpcomingCard t={t} upcoming={upcoming} intlLocale={localeToIntl(locale)} />
          </>
        }
        empty={variant === "full" && steps ? <FirstRunChecklist t={t} steps={steps} variant="full" /> : <DashboardEmptyState />}
        // The per-account links into /accounts/[id] stay live for a granted
        // portfolio - that page is scoped by the same view context and renders
        // read-only too. interactive=false is for the anonymous /shared/[token]
        // route, which must not expose them at all.
        interactive
      />
    </>
  );
}
