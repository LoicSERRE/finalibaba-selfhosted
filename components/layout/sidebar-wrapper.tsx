import { SidebarDynamic } from "@/components/layout/sidebar-dynamic";

export function SidebarWrapper() {
  const showLogout = process.env.AUTH_ENABLED === "true";
  return <SidebarDynamic showLogout={showLogout} />;
}
