import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { COUNTRY_CODES, FR_PFU_TOTAL_RATE, FR_SOCIAL_LEVIES_RATE } from "@/lib/domain/tax-locale";
import { updateTaxSettings } from "@/lib/actions/user-settings";
import { SaveSettingsButton } from "@/components/settings/save-settings-button";

/**
 * Country preset and the three latent-tax rates.
 *
 * Extracted from app/settings/page.tsx, which rendered this 109-line form
 * inline while every one of its twenty-odd siblings on the same page was
 * already its own `*-section.tsx`. It was the exception, not the rule.
 *
 * The page function it came out of was long enough that lizard - which
 * `quality.yml`'s complexity ratchet runs - could hold onto it only
 * intermittently: a small edit elsewhere in the file made it report ZERO
 * functions for the whole page, at no exit code and no warning, which reads
 * exactly like a page with nothing complex in it. Keeping each section a
 * component of its own is what keeps that measurable.
 */
export async function TaxSettingsSection({
  settings,
}: Readonly<{
  settings: {
    country: string | null;
    taxRatePea: number;
    taxRateCto: number;
    taxRateCrypto: number;
  };
}>) {
  const t = await getTranslations();

  return (
  <section className="space-y-4">
    <div>
      <h2 className="text-base font-semibold text-[var(--foreground)]">{t("settings.tax.title")}</h2>
      <p className="text-xs text-[var(--muted)] mt-0.5">{t("settings.tax.subtitle")}</p>
    </div>
    <form action={updateTaxSettings} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
      {/* Governs which wrappers and rates the rest of the app SUGGESTS -
          never what it computes. See lib/domain/tax-locale.ts: the app
          does not model anyone's tax law, it just stops proposing French
          products to someone who does not live in France. */}
      <div className="space-y-1.5 max-w-xs">
        <label htmlFor="country" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
          {t("settings.tax.country")}
        </label>
        <select
          id="country"
          name="country"
          defaultValue={settings.country ?? ""}
          className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30"
        >
          <option value="">{t("settings.tax.countryUnset")}</option>
          {COUNTRY_CODES.map((code) => (
            <option key={code} value={code}>
              {t(`settings.tax.countries.${code}`)}
            </option>
          ))}
        </select>
        <p className="text-xs text-[var(--muted)] opacity-70">{t("settings.tax.countryHint")}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <label htmlFor="taxRatePea" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
            {t("settings.tax.pea")}
          </label>
          <div className="relative">
            <input
              id="taxRatePea"
              name="taxRatePea"
              type="number"
              inputMode="decimal"
              autoComplete="off"
              min="0"
              max="100"
              step="0.1"
              defaultValue={+(settings.taxRatePea * 100).toFixed(1)}
              placeholder={(FR_SOCIAL_LEVIES_RATE * 100).toFixed(1)}
              className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 pr-8 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 tabular-nums"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">%</span>
          </div>
          <p className="text-xs text-[var(--muted)] opacity-70">{t("settings.tax.peaHint")}</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="taxRateCto" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
            {t("settings.tax.cto")}
          </label>
          <div className="relative">
            <input
              id="taxRateCto"
              name="taxRateCto"
              type="number"
              inputMode="decimal"
              autoComplete="off"
              min="0"
              max="100"
              step="0.1"
              defaultValue={+(settings.taxRateCto * 100).toFixed(1)}
              placeholder={(FR_PFU_TOTAL_RATE * 100).toFixed(1)}
              className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 pr-8 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 tabular-nums"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">%</span>
          </div>
          <p className="text-xs text-[var(--muted)] opacity-70">{t("settings.tax.ctoHint")}</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="taxRateCrypto" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
            {t("settings.tax.crypto")}
          </label>
          <div className="relative">
            <input
              id="taxRateCrypto"
              name="taxRateCrypto"
              type="number"
              inputMode="decimal"
              autoComplete="off"
              min="0"
              max="100"
              step="0.1"
              defaultValue={+(settings.taxRateCrypto * 100).toFixed(1)}
              placeholder={(FR_PFU_TOTAL_RATE * 100).toFixed(1)}
              className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 pr-8 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 tabular-nums"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">%</span>
          </div>
          <p className="text-xs text-[var(--muted)] opacity-70">{t("settings.tax.cryptoHint")}</p>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <Link
          href="/tax-report"
          className="text-xs text-[var(--accent-text)] hover:underline underline-offset-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
        >
          {t("settings.tax.taxReportLink")}
        </Link>
        <SaveSettingsButton />
      </div>
    </form>
  </section>
  );
}
