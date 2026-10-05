import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/settings/language-switcher";
import { ThemeSwitcher } from "@/components/settings/theme-switcher";
import { resolveThemePreference } from "@/lib/domain/theme";
import { SECTION_CARD, SECTION_TITLE } from "./context";

/** Language and theme. */
export async function DisplayTab() {
  const [t, cookieStore] = await Promise.all([getTranslations("settings"), cookies()]);
  const theme = resolveThemePreference(cookieStore.get("THEME")?.value);
  return (
    <>
      <section id="language" className="space-y-4">
        <h2 className={SECTION_TITLE}>{t("language.title")}</h2>
        <div className={`${SECTION_CARD} p-5`}>
          <LanguageSwitcher />
        </div>
      </section>

      <section id="theme" className="space-y-4">
        <h2 className={SECTION_TITLE}>{t("theme.title")}</h2>
        <div className={`${SECTION_CARD} p-5`}>
          <ThemeSwitcher theme={theme} />
        </div>
      </section>
    </>
  );
}
