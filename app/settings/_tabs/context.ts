import type { Viewer } from "@/lib/auth-context";
import type { SettingsVisibility } from "@/lib/domain/settings-tabs";

/**
 * What the page resolves once and hands to whichever tab it renders. Each tab
 * fetches its own data on top of this, and only its own: that is the point of
 * splitting the page, since the single-column version paid for every
 * section's queries on every visit.
 */
export type SettingsTabProps = Readonly<{
  viewer: Viewer;
  show: SettingsVisibility;
  isAdmin: boolean;
  isMulti: boolean;
}>;

/** The heading block every section in Settings opens with. */
export const SECTION_TITLE = "text-base font-semibold text-[var(--foreground)]";
export const SECTION_SUBTITLE = "text-xs text-[var(--muted)] mt-0.5";
export const SECTION_CARD = "bg-[var(--surface)] border border-[var(--border)] rounded-xl";
