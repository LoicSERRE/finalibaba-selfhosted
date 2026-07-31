import { SidebarDynamic } from "@/components/sidebar-dynamic";

export function SidebarWrapper() {
  const showLogout = process.env.AUTH_ENABLED === "true";
  return <SidebarDynamic showLogout={showLogout} />;
}
