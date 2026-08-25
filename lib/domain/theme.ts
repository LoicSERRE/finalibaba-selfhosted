// Shared by app/layout.tsx (data-theme attribute + colorScheme) and
// app/settings/page.tsx (the ThemeSwitcher's current-value prop) so the
// THEME cookie is normalized exactly once, the same way everywhere it's
// read - see app/globals.css's "Light theme" comment for why "dark" stays
// the safe default for an unset/invalid cookie rather than falling
// through to "auto".
export type ThemePreference = "dark" | "light" | "auto";

export function resolveThemePreference(cookieValue: string | undefined): ThemePreference {
  if (cookieValue === "light" || cookieValue === "auto") return cookieValue;
  return "dark";
}
