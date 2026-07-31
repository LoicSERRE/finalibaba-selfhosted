"use client";

import dynamic from "next/dynamic";

// ssr:false prevents usePathname from running during build-time prerendering
// of /_not-found and /_global-error. Must live in a Client Component.
const SidebarClient = dynamic(
  () => import("@/components/sidebar").then((m) => ({ default: m.Sidebar })),
  { ssr: false }
);

export function SidebarDynamic({ showLogout }: { showLogout: boolean }) {
  return <SidebarClient showLogout={showLogout} />;
}
