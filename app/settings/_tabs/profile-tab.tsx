import { prisma } from "@/lib/db/prisma";
import { getTranslations } from "next-intl/server";
import { baseAccountIds } from "@/lib/auth-context";
import { getUserSettings, updateFinancialProfile } from "@/lib/actions/user-settings";
import { getGoals } from "@/lib/actions/goals";
import { SaveSettingsButton } from "@/components/settings/save-settings-button";
import { GoalsSection } from "@/components/settings/goals-section";
import { TaxSettingsSection } from "@/components/settings/tax-settings-section";
import type { SettingsTabProps } from "./context";

/** Income and spending figures, savings goals, and tax defaults. */
export async function ProfileTab({ viewer }: SettingsTabProps) {
  // Settings only ever configures the viewer's OWN portfolio (goal pickers
  // feed per-user artifacts), so this is baseAccountIds - never a granted view.
  const accountIds = await baseAccountIds(viewer.id);
  const [userSettings, goals, goalEligibleAccounts, t] = await Promise.all([
    getUserSettings(),
    getGoals(),
    // A goal's linked account can be REAL_ESTATE/AUTOMOBILE too (e.g. "down
    // payment" toward a house) - LOAN is the only exclusion, see
    // components/settings/goals-section.tsx and the Goal model's own schema
    // comment for why.
    prisma.account.findMany({
      where: { id: { in: accountIds }, type: { not: "LOAN" } },
      select: { id: true, name: true, type: true },
      orderBy: { name: "asc" },
    }),
    getTranslations(),
  ]);

  return (
    <>
      <section id="financial-profile" className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">{t("settings.profile.title")}</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">{t("settings.profile.subtitle")}</p>
        </div>
        <form action={updateFinancialProfile} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="salary" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                {t("settings.profile.salary")}
              </label>
              <div className="relative">
                <input
                  id="salary"
                  name="salary"
                  type="number"
                  inputMode="decimal"
                  autoComplete="off"
                  min="0"
                  step="1"
                  defaultValue={Number(userSettings.salaryNetCents) / 100}
                  placeholder="2000"
                  className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 pr-8 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 tabular-nums"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">€</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="expenses" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                {t("settings.profile.expenses")}
              </label>
              <div className="relative">
                <input
                  id="expenses"
                  name="expenses"
                  type="number"
                  inputMode="decimal"
                  autoComplete="off"
                  min="0"
                  step="1"
                  defaultValue={Number(userSettings.monthlyExpensesCents) / 100}
                  placeholder="900"
                  className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 pr-8 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 tabular-nums"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">€</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="saved" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                {t("settings.profile.saved")}
              </label>
              <div className="relative">
                <input
                  id="saved"
                  name="saved"
                  type="number"
                  inputMode="decimal"
                  autoComplete="off"
                  min="0"
                  step="1"
                  defaultValue={Number(userSettings.monthlySavedCents) / 100}
                  placeholder="1100"
                  className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 pr-8 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 tabular-nums"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">€</span>
              </div>
              <p className="text-xs text-[var(--muted)] opacity-70">{t("settings.profile.savedHint")}</p>
            </div>
          </div>
          <div className="flex justify-end">
            <SaveSettingsButton />
          </div>
        </form>
      </section>

      {/* Savings goals (v1.14). Not demo-gated, same precedent as the
          financial profile above - unlike alerts, a goal never sends a real
          notification, so there is nothing demo-unsafe about it. */}
      <GoalsSection goals={goals} accounts={goalEligibleAccounts} />

      <TaxSettingsSection settings={userSettings} />
    </>
  );
}
