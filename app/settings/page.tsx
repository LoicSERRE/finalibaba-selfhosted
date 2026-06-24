export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { Settings } from "lucide-react";
import { AddInstitutionDialog } from "@/components/add-institution-dialog";
import { DeleteButton } from "@/components/delete-button";
import { EmptyState } from "@/components/empty-state";
import { deleteInstitution } from "@/lib/actions/institutions";
import { InstitutionLogo } from "@/components/institution-logo";
import { getInstitutionLogoUrl } from "@/lib/institutions";
import { ConnectOpenBankingButton, SyncOpenBankingButton } from "@/components/open-banking-buttons";
import { ConnectOpenBankingDialog } from "@/components/connect-open-banking-dialog";
import { ConfigureWoobDialog } from "@/components/configure-woob-dialog";
import { InstitutionSyncButton } from "@/components/institution-sync-button";
import { SyncStatus } from "@/components/sync-status";
import { getSyncStatus } from "@/lib/actions/sync";
import { getUserSettings, updateUserSettings } from "@/lib/actions/user-settings";
import { SaveSettingsButton } from "@/components/save-settings-button";
import { CheckCircle, AlertTriangle, Clock } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";

// Institutions gérées par des scripts dédiés (pas Woob) — identifiées par nom
const DEDICATED_SYNC_INSTITUTIONS = ["lcl", "trade republic"];

export default async function SettingsPage() {
  const gcConfigured = !!process.env.GOCARDLESS_SECRET_ID;

  const [institutions, syncStatus, userSettings, t] = await Promise.all([
    prisma.institution.findMany({
      include: {
        _count: { select: { accounts: true } },
        accounts: { where: { gocardlessAccountId: { not: null } }, select: { id: true } },
      },
      orderBy: { name: "asc" },
    }),
    getSyncStatus(),
    getUserSettings(),
    getTranslations(),
  ]);

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">{t("settings.title")}</h1>
        <p className="text-sm text-[var(--muted)] mt-1">{t("settings.subtitle")}</p>
      </div>

      {/* Institutions */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">{t("settings.institutions.title")}</h2>
            <p className="text-xs text-[var(--muted)] mt-0.5">{t("settings.institutions.subtitle")}</p>
          </div>
          <AddInstitutionDialog />
        </div>

        {institutions.length === 0 ? (
          <EmptyState
            icon={Settings}
            title={t("settings.institutions.emptyTitle")}
            description={t("settings.institutions.emptyDescription")}
            action={<AddInstitutionDialog />}
          />
        ) : (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
            {institutions.map((inst) => (
              <div
                key={inst.id}
                className="px-5 py-3.5 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <InstitutionLogo
                    name={inst.name}
                    logoUrl={inst.logoUrl ?? getInstitutionLogoUrl(inst.name)}
                    size={32}
                  />
                  <div>
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      {inst.name}
                    </p>
                    <p className="text-xs text-[var(--muted)] mt-0.5">
                      {inst._count.accounts === 1
                        ? t("settings.institutions.accounts", { count: inst._count.accounts })
                        : t("settings.institutions.accountsPlural", { count: inst._count.accounts })}
                      {inst.gocardlessInstitutionId && (
                        <span className="ml-2 text-[var(--accent)]">· {t("settings.institutions.openBanking")}</span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* GoCardless Open Banking */}
                  {gcConfigured && (
                    inst.gocardlessInstitutionId
                      ? inst.accounts.length > 0
                        ? <SyncOpenBankingButton institutionId={inst.id} />
                        : <ConnectOpenBankingButton institutionId={inst.id} />
                      : <ConnectOpenBankingDialog institutionId={inst.id} institutionName={inst.name} />
                  )}
                  {/* Woob sync */}
                  {(() => {
                    if (DEDICATED_SYNC_INSTITUTIONS.includes(inst.name.toLowerCase())) return null;

                    const woobLog = syncStatus[`woob:${inst.id}`] ?? null;
                    return (
                      <>
                        {inst.woobModule && woobLog && (
                          <span className={`flex items-center gap-1 text-xs ${
                            woobLog.status === "success" ? "text-[var(--positive)]" :
                            woobLog.status === "auth_required" ? "text-amber-400" :
                            "text-[var(--negative)]"
                          }`}>
                            {woobLog.status === "success"
                              ? <CheckCircle size={12} />
                              : <AlertTriangle size={12} />}
                          </span>
                        )}
                        {inst.woobModule && !woobLog && (
                          <Clock size={12} className="text-[var(--muted)]" />
                        )}
                        {inst.woobModule && <InstitutionSyncButton institutionId={inst.id} />}
                        <ConfigureWoobDialog
                          institutionId={inst.id}
                          institutionName={inst.name}
                          currentModule={inst.woobModule}
                        />
                      </>
                    );
                  })()}
                  <DeleteButton
                    label={t("common.delete")}
                    description={t("deleteInstitution.description", { name: inst.name })}
                    onDelete={async () => {
                      "use server";
                      await deleteInstitution(inst.id);
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Financial profile */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">{t("settings.profile.title")}</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">{t("settings.profile.subtitle")}</p>
        </div>
        <form action={updateUserSettings} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
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
            <div className="space-y-1.5">
              <label htmlFor="goal" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                {t("settings.profile.goal")}
              </label>
              <div className="relative">
                <input
                  id="goal"
                  name="goal"
                  type="number"
                  inputMode="decimal"
                  autoComplete="off"
                  min="0"
                  step="1000"
                  defaultValue={Number(userSettings.savingsGoalCents) / 100}
                  placeholder="50000"
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

      {/* Tax rates */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">{t("settings.tax.title")}</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">{t("settings.tax.subtitle")}</p>
        </div>
        <form action={updateUserSettings} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
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
                  defaultValue={+(userSettings.taxRatePea * 100).toFixed(1)}
                  placeholder="17.2"
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
                  defaultValue={+(userSettings.taxRateCto * 100).toFixed(1)}
                  placeholder="31.4"
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
                  defaultValue={+(userSettings.taxRateCrypto * 100).toFixed(1)}
                  placeholder="31.4"
                  className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 pr-8 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 tabular-nums"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">%</span>
              </div>
              <p className="text-xs text-[var(--muted)] opacity-70">{t("settings.tax.cryptoHint")}</p>
            </div>
          </div>
          <div className="flex justify-end">
            <SaveSettingsButton />
          </div>
        </form>
      </section>

      {/* Language */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">{t("settings.language.title")}</h2>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
          <LanguageSwitcher />
        </div>
      </section>

      {/* Auto-sync */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">{t("settings.sync.title")}</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">{t("settings.sync.subtitle")}</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-5 divide-y divide-[var(--border)]">
          <SyncStatus
            source="lcl"
            label="LCL"
            log={syncStatus["lcl"] ?? null}
          />
          <SyncStatus
            source="trade-republic"
            label="Trade Republic"
            log={syncStatus["trade_republic"] ?? null}
          />
        </div>
      </section>

    </div>
  );
}
