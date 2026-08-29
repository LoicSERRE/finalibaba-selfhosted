import { SidebarDynamic } from "@/components/layout/sidebar-dynamic";
import { prisma } from "@/lib/db/prisma";
import { getViewer, isAuthEnabled, VIEWING_PORTFOLIO_COOKIE } from "@/lib/auth-context";
import { cookies } from "next/headers";

export async function SidebarWrapper() {
  const showLogout = isAuthEnabled();

  // Portfolios granted to this viewer, for the switcher. Skipped entirely in
  // mono mode: with no login there is nobody to have granted anything, so this
  // would be a guaranteed-empty query on every single page render.
  let portfolios: { userId: string; label: string }[] = [];
  let viewingPortfolioId: string | undefined;

  if (showLogout) {
    const viewer = await getViewer();
    const grants = await prisma.portfolioGrant.findMany({
      where: { granteeUserId: viewer.id },
      select: { grantorUserId: true, grantor: { select: { username: true, displayName: true } } },
      orderBy: { createdAt: "asc" },
    });
    portfolios = grants.map((g) => ({
      userId: g.grantorUserId,
      label: g.grantor.displayName ?? g.grantor.username ?? g.grantorUserId,
    }));

    // Only reflect the cookie when it names a portfolio still in the list -
    // otherwise the switcher would show a stale selection while the pages,
    // which re-validate the grant themselves, correctly show your own data.
    const requested = (await cookies()).get(VIEWING_PORTFOLIO_COOKIE)?.value;
    if (requested && portfolios.some((p) => p.userId === requested)) {
      viewingPortfolioId = requested;
    }
  }

  return (
    <SidebarDynamic
      showLogout={showLogout}
      portfolios={portfolios}
      viewingPortfolioId={viewingPortfolioId}
    />
  );
}
