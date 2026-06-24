"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Wallet, BarChart3, Settings, LogOut } from "lucide-react";
import { useTranslations } from "next-intl";

type SidebarProps = { showLogout?: boolean };

export function Sidebar({ showLogout = false }: SidebarProps) {
  const rawPathname = usePathname();
  const pathname = rawPathname ?? "/";
  const t = useTranslations("nav");

  const navItems = [
    { href: "/", label: t("dashboard"), icon: LayoutDashboard, exact: true },
    { href: "/accounts", label: t("accounts"), icon: Wallet, exact: false },
    { href: "/analytics", label: t("analytics"), icon: BarChart3, exact: false },
    { href: "/settings", label: t("settings"), icon: Settings, exact: false },
  ];

  return (
    <>
      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex flex-col w-56 min-h-screen bg-[var(--surface)] border-r border-[var(--border)] px-3 py-6 shrink-0">
        {/* Logo */}
        <div className="px-3 mb-8 flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 relative overflow-hidden"
            style={{ background: "linear-gradient(135deg, #6366f1, #4338ca)" }}
          >
            <span className="text-white font-extrabold text-sm select-none">F</span>
            <div className="absolute bottom-0.5 right-0.5 flex items-end gap-px">
              <div className="w-0.5 h-1 rounded-sm bg-green-400 opacity-90" />
              <div className="w-0.5 h-1.5 rounded-sm bg-green-400 opacity-90" />
              <div className="w-0.5 h-2 rounded-sm bg-green-400 opacity-90" />
            </div>
          </div>
          <span className="text-base font-semibold tracking-tight text-[var(--foreground)]">
            Finalibaba
          </span>
        </div>

        <nav aria-label={t("ariaMain")} className="flex flex-col gap-1 flex-1">
          {navItems.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition active:scale-[0.97] active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] ${
                  active
                    ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                    : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-elevated)]"
                }`}
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Logout — only shown when AUTH_ENABLED=true */}
        {showLogout && (
          <button
            onClick={async () => {
              const { signOut } = await import("next-auth/react");
              signOut({ callbackUrl: "/login" });
            }}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-[var(--muted)] hover:text-[var(--negative)] hover:bg-[var(--surface-elevated)] transition-colors w-full mt-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
          >
            <LogOut size={16} aria-hidden="true" />
            {t("logout")}
          </button>
        )}
      </aside>

      {/* ── Mobile bottom nav ── */}
      <nav aria-label={t("ariaMobile")} className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex bg-[var(--surface)] border-t border-[var(--border)] pb-safe">
        {navItems.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 mx-1 rounded-xl transition active:scale-[0.93] active:opacity-80 focus-visible:outline-none focus-visible:bg-[var(--surface-elevated)] ${
                active
                  ? "text-[var(--accent)] bg-[var(--accent)]/10"
                  : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-elevated)]"
              }`}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 1.8} aria-hidden="true" />
              <span className="text-[12px] font-medium tracking-tight">{label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
