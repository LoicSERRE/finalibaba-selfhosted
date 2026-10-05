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
 * A vertical menu beside the content from `md` up; below it, a row that
 * scrolls sideways on its own (never the page) and stays at the top while the
 * tab's content scrolls under it.
 */
export async function SettingsTabNav({
  tabs,
  active,
}: Readonly<{ tabs: SettingsTab[]; active: SettingsTab }>) {
  const t = await getTranslations("settings.tabs");
  return (
    <nav
      aria-label={t("navLabel")}
      className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-[var(--background)] md:static md:mx-0 md:px-0 md:py-0 md:bg-transparent"
    >
      <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {tabs.map((tab) => {
          const Icon = TAB_ICONS[tab];
          const isActive = tab === active;
          return (
            <li key={tab} className="shrink-0">
              <Link
                href={settingsTabHref(tab)}
                aria-current={isActive ? "page" : undefined}
                data-settings-tab={tab}
                className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 min-h-11 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                  isActive
                    ? "bg-[var(--surface-elevated)] text-[var(--foreground)] font-medium"
                    : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)]"
                }`}
              >
                <Icon size={16} aria-hidden="true" className={isActive ? "text-[var(--accent-text)]" : undefined} />
                {t(tab)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
