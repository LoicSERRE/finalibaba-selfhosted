import { cookies } from "next/headers";
import { SidebarDynamic } from "@/components/layout/sidebar-dynamic";
import type { PortfolioOption } from "@/components/layout/portfolio-switcher";
import {
  COMPANY_SCOPE_PREFIX,
  getViewer,
  grantedPortfolios,
  isAuthEnabled,
  viewerCompanies,
  VIEWING_PORTFOLIO_COOKIE,
} from "@/lib/auth-context";

export async function SidebarWrapper() {
  const showLogout = isAuthEnabled();

  // What the switcher offers: the companies the viewer manages or holds an
  // accepted link to - in mono mode too, where the owner manages them - and,
  // with auth on, the portfolios granted to them (mono mode has nobody to
  // have granted anything, so that query is skipped there).
  const viewer = await getViewer();
  const companies: PortfolioOption[] = (await viewerCompanies(viewer.id)).map((c) => ({
    userId: `${COMPANY_SCOPE_PREFIX}${c.id}`,
    label: c.name,
    readOnly: c.role !== "manager",
    company: true,
  }));
  const grants: PortfolioOption[] = showLogout
    ? (await grantedPortfolios(viewer.id)).map((g) => ({ ...g, readOnly: true }))
    : [];
  const portfolios = [...grants, ...companies];

  // Only reflect the cookie when it names a portfolio still in the list -
  // otherwise the switcher would show a stale selection while the pages,
  // which re-validate the grant themselves, correctly show your own data.
  const requested = (await cookies()).get(VIEWING_PORTFOLIO_COOKIE)?.value;
  const viewingPortfolioId = requested && portfolios.some((p) => p.userId === requested) ? requested : undefined;

  return (
    <SidebarDynamic
      showLogout={showLogout}
      portfolios={portfolios}
      viewingPortfolioId={viewingPortfolioId}
    />
  );
}
