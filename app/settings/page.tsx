export const dynamic = "force-dynamic";

import { getTranslations } from "next-intl/server";
import { getViewer, isAuthEnabled, isDemoMode } from "@/lib/auth-context";
import {
  resolveSettingsTab,
  settingsVisibility,
  visibleSettingsTabs,
  type SettingsTab,
} from "@/lib/domain/settings-tabs";
import { SettingsTabNav } from "@/components/settings/settings-tab-nav";
import { ActiveTabIntoView } from "@/components/settings/active-tab-into-view";
import { FormAlert } from "@/components/ui/form-alert";
import { AccountsTab } from "./_tabs/accounts-tab";
import { ProfileTab } from "./_tabs/profile-tab";
import { SecurityTab } from "./_tabs/security-tab";
import { SharingTab } from "./_tabs/sharing-tab";
import { NotificationsTab } from "./_tabs/notifications-tab";
import { DisplayTab } from "./_tabs/display-tab";
import type { SettingsTabProps } from "./_tabs/context";

// The GoCardless callback redirects back here with a ?gc= status. The three
// outcomes (connected / error / already connected by someone else) need
// different words, and the third genuinely needs an explanation - see the H7
// note in app/api/gocardless/callback/route.ts.
const GC_STATUS = {
  connected: { key: "gcConnected", tone: "success" },
  error: { key: "gcError", tone: "error" },
  "already-connected": { key: "gcAlreadyConnected", tone: "warning" },
} as const;

const TAB_CONTENT: Record<SettingsTab, (props: SettingsTabProps) => Promise<React.ReactNode>> = {
  accounts: AccountsTab,
  profile: ProfileTab,
  security: SecurityTab,
  sharing: SharingTab,
  notifications: NotificationsTab,
  display: DisplayTab,
};

/**
 * Settings, one tab at a time. This page only decides WHICH tab: each tab is
 * its own Server Component under ./_tabs and fetches only the data it shows,
 * so opening "Display" no longer pays for every institution's sync status,
 * the audit log and the alert-rule pickers. See lib/domain/settings-tabs.ts.
 */
export default async function SettingsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ tab?: string | string[]; gc?: string }> }>) {
  const params = await searchParams;
  const [viewer, t] = await Promise.all([getViewer(), getTranslations("settings")]);

  const isMulti = isAuthEnabled();
  const isAdmin = viewer.role === "ADMIN";
  const show = settingsVisibility({ isDemo: isDemoMode(), isMulti, isAdmin });
  const tabs = visibleSettingsTabs(show);
  const active = resolveSettingsTab(params.tab, tabs);
  const gcStatus = GC_STATUS[params.gc as keyof typeof GC_STATUS];
  const Content = TAB_CONTENT[active];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">{t("title")}</h1>
        <p className="text-sm text-[var(--muted)] mt-1">{t("subtitle")}</p>
      </div>

      {gcStatus && <FormAlert tone={gcStatus.tone}>{t(gcStatus.key)}</FormAlert>}

      <div className="md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8 md:items-start">
        {/* Sticky HERE, not on the <nav>: a sticky element only sticks inside
            its parent, and this wrapper is exactly as tall as the nav, so a
            sticky nav inside it never stuck at all. This div's parent spans
            the whole tab content, so the tab row now stays in reach on a
            phone while the content scrolls under it. */}
        <div className="sticky top-0 z-10 mb-6 md:mb-0 md:top-8">
          <ActiveTabIntoView>
            <SettingsTabNav tabs={tabs} active={active} />
          </ActiveTabIntoView>
        </div>
        <div id={`settings-${active}`} data-settings-panel={active} className="min-w-0 space-y-8">
          <Content viewer={viewer} show={show} isAdmin={isAdmin} isMulti={isMulti} />
        </div>
      </div>
    </div>
  );
}
