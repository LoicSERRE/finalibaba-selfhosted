/**
 * Which Settings tabs exist, and which one a request is asking for.
 *
 * The page used to be 22 sections in one column, every one of them fetching
 * its data on every visit. It is now six tabs, each a Server Component that
 * loads only what it shows, selected by `?tab=` so a tab is linkable and the
 * back button works. The path stays `/settings`, so every
 * `revalidatePath("/settings")` and the two-factor gate's `/settings`
 * exemption keep working unchanged.
 *
 * Slugs are English and stable: they appear in URLs that get bookmarked and
 * in links from other pages. The labels are translated separately.
 */
export const SETTINGS_TABS = ["accounts", "profile", "security", "sharing", "notifications", "display"] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

/**
 * The four questions every Settings section is gated on. These only decide
 * what is worth rendering - the server-side guards are elsewhere and
 * unchanged (proxy.ts refuses every non-GET in demo mode, the backup routes
 * enforce admin themselves) - so nobody is offered a control whose only
 * possible outcome is an error.
 */
export type SettingsVisibility = {
  /** Mutates, reveals a stored credential, or mints a token. */
  sensitive: boolean;
  /** ...and is the instance admin's alone to touch. */
  adminOnly: boolean;
  /** ...and means nothing without a real login to attach it to. */
  withAuth: boolean;
  /** ...and is how an admin manages everyone else's access. */
  userManagement: boolean;
};

export function settingsVisibility({
  isDemo,
  isMulti,
  isAdmin,
}: Readonly<{ isDemo: boolean; isMulti: boolean; isAdmin: boolean }>): SettingsVisibility {
  const sensitive = !isDemo;
  return {
    sensitive,
    adminOnly: sensitive && isAdmin,
    withAuth: sensitive && isMulti,
    userManagement: sensitive && isMulti && isAdmin,
  };
}

/**
 * The tabs that have at least one section to show. A tab with nothing in it
 * is left out rather than rendered empty.
 *
 * - accounts, profile, display: institutions, the financial profile and
 *   language/theme render in every mode, demo included.
 * - security: app-lock and "my data" need only `sensitive`; account, 2FA and
 *   sessions additionally need auth. So it exists whenever `sensitive` does.
 * - sharing: share links and API keys work without auth (by design, see
 *   "Read-only share links"), so it too exists whenever `sensitive` does.
 * - notifications: every section in it is `sensitive`.
 */
export function visibleSettingsTabs(show: SettingsVisibility): SettingsTab[] {
  return SETTINGS_TABS.filter((tab) => {
    if (tab === "security" || tab === "sharing" || tab === "notifications") return show.sensitive;
    return true;
  });
}

/** The requested tab when it exists in this mode, otherwise the first one. */
export function resolveSettingsTab(requested: string | string[] | undefined, visible: SettingsTab[]): SettingsTab {
  const value = Array.isArray(requested) ? requested[0] : requested;
  return visible.find((tab) => tab === value) ?? visible[0];
}

/** The URL of a tab, carrying any extra query parameters along. */
export function settingsTabHref(tab: SettingsTab, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ tab, ...extra });
  return `/settings?${params.toString()}`;
}
