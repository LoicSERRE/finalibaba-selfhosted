import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Bell, Building2, Palette, Share2, ShieldCheck, Wallet } from "lucide-react";
import { settingsTabHref, type SettingsTab } from "@/lib/domain/settings-tabs";

const TAB_ICONS: Record<SettingsTab, typeof Bell> = {
  accounts: Building2,
  profile: Wallet,
  security: ShieldCheck,
  sharing: Share2,
  notifications: Bell,
  display: Palette,
};

/**
 * Settings navigation. Plain links rather than an ARIA tablist: every tab is
 * its own URL with its own server render, and for navigation that changes the
 * page a list of links marked `aria-current="page"` is the pattern assistive
 * technology expects - a `role="tab"` widget promises arrow-key behaviour and
 * an in-page panel that do not exist here. No client JavaScript at all.
 *
 * A vertical menu beside the content from `lg` up. Below it, a 3x2 grid of
 * icon-over-label tiles with short names, so every section is visible at
 * once. It replaced a row that scrolled sideways: functional, but nothing on
 * screen said more tabs existed past the edge, and it was reported as the
 * one part of Settings that still felt off on a phone.
 */
export async function SettingsTabNav({
  tabs,
  active,
}: Readonly<{ tabs: SettingsTab[]; active: SettingsTab }>) {
  const t = await getTranslations("settings.tabs");
  return (
    <nav
      aria-label={t("navLabel")}
    >
      <ul className="grid grid-cols-3 gap-1.5 lg:flex lg:flex-col lg:gap-1">
        {tabs.map((tab) => {
          const Icon = TAB_ICONS[tab];
          const isActive = tab === active;
          return (
            <li key={tab}>
              <Link
                href={settingsTabHref(tab)}
                aria-current={isActive ? "page" : undefined}
                data-settings-tab={tab}
                className={`flex flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 min-h-[3.5rem] text-xs text-center border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:flex-row lg:justify-start lg:gap-2 lg:px-3 lg:min-h-11 lg:text-sm lg:text-left lg:whitespace-nowrap lg:border-transparent ${
                  isActive
                    ? "bg-[var(--surface-elevated)] border-[var(--border)] text-[var(--foreground)] font-medium"
                    : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)]"
                }`}
              >
                <Icon size={16} aria-hidden="true" className={isActive ? "text-[var(--accent-text)]" : undefined} />
                <span className="lg:hidden">{t(`short.${tab}`)}</span>
                <span className="hidden lg:inline">{t(tab)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
