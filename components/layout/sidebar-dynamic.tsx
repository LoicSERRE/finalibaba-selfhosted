"use client";

import dynamic from "next/dynamic";
import type { PortfolioOption } from "@/components/layout/portfolio-switcher";

// ssr:false prevents usePathname from running during build-time prerendering
// of /_not-found and /_global-error. Must live in a Client Component.
const SidebarClient = dynamic(
  () => import("@/components/layout/sidebar").then((m) => ({ default: m.Sidebar })),
  { ssr: false }
);

export function SidebarDynamic({
  showLogout,
  portfolios,
  viewingPortfolioId,
}: Readonly<{
  showLogout: boolean;
  portfolios: PortfolioOption[];
  viewingPortfolioId?: string;
}>) {
  return (
    <SidebarClient
      showLogout={showLogout}
      portfolios={portfolios}
      viewingPortfolioId={viewingPortfolioId}
    />
  );
}
