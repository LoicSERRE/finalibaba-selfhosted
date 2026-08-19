export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db/prisma";
import Link from "next/link";
import { Settings, CheckCircle, AlertTriangle, Clock } from "lucide-react";
import { AddInstitutionDialog } from "@/components/settings/add-institution-dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { EmptyState } from "@/components/shared/empty-state";
import { deleteInstitution, migrateDedicatedSyncToWoob } from "@/lib/actions/institutions";
import { InstitutionLogo } from "@/components/shared/institution-logo";
import { getInstitutionLogoUrl } from "@/lib/domain/institutions";
import { ConnectOpenBankingButton, SyncOpenBankingButton } from "@/components/settings/open-banking-buttons";
import { ConnectOpenBankingDialog } from "@/components/settings/connect-open-banking-dialog";
import { ConfigureWoobDialog } from "@/components/settings/configure-woob-dialog";
import { InstitutionSyncButton } from "@/components/settings/institution-sync-button";
import { WoobSetupPrompt } from "@/components/settings/woob-setup-prompt";
import { SyncStatus } from "@/components/settings/sync-status";
import { getSyncStatus, getWoobBankModules } from "@/lib/actions/sync";
import { getUserSettings, updateUserSettings } from "@/lib/actions/user-settings";
import { SaveSettingsButton } from "@/components/settings/save-settings-button";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/settings/language-switcher";
import { BackupRestoreSection } from "@/components/settings/backup-restore-section";
import { TwoFactorSection } from "@/components/settings/two-factor-section";
import { ShareLinksSection } from "@/components/settings/share-links-section";
import { getShareLinks } from "@/lib/actions/share-links";
import { AlertChannelsSection } from "@/components/settings/alert-channels-section";
import { AlertTriggersSection } from "@/components/settings/alert-triggers-section";
import { AlertRulesSection } from "@/components/settings/alert-rules-section";
import { getAlertRules } from "@/lib/actions/alert-rules";

// Names of the dedicated .env-configured sync integrations that currently
// have real credentials set - used to warn before a user also configures
// Woob credentials on an institution of the same name (see the woobDialog
// props below). Real production incident: configuring Woob on the existing
// seeded "LCL" institution while LCL_LOGIN was still active created a full
// second set of accounts, since sync_lcl.py and sync_woob.py write
// different syncId prefixes ("lcl:..." vs "woob:<institutionId>:...") and
// can't recognize each other's rows as the same bank account.
function dedicatedEnvNames(): Set<string> {
  const names = new Set<string>();
  if (process.env.LCL_LOGIN) names.add("lcl");
  if (process.env.TR_PHONE) names.add("trade republic");
  return names;
}

export default async function SettingsPage() {
  const gcConfigured = !!process.env.GOCARDLESS_SECRET_ID;
  const dedicatedSyncNames = dedicatedEnvNames();

  const [institutions, syncStatus, woobModules, userSettings, shareLinks, alertRules, fiatAccounts, investmentAccounts, budgetCategories, t] =
    await Promise.all([
      prisma.institution.findMany({
        include: {
          _count: { select: { accounts: true } },
          // syncId is fetched for every account (not gocardless-filtered
          // like the old query) so migrateDedicatedSyncToWoob's UI below can
          // count "lcl:"/"tr:" (dedicated-env) vs "woob:<id>:" (already
          // migrated) accounts per institution - see that action's own
          // comment for why both counts matter to the user before they
          // confirm the migration.
          accounts: { select: { id: true, syncId: true, gocardlessAccountId: true } },
        },
        orderBy: { name: "asc" },
      }),
      getSyncStatus(),
      getWoobBankModules(),
      getUserSettings(),
      getShareLinks(),
      getAlertRules(),
      prisma.account.findMany({
        where: { type: { in: ["CHECKING", "SAVINGS", "MEAL_VOUCHER"] } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      // INVESTMENT_VALUE + UNREALIZED_GAIN's account picker, and
      // HOLDING_PRICE's holding picker (flattened from these accounts'
      // holdings in the component) - see components/settings/alert-rules-section.tsx.
      prisma.account.findMany({
        where: { type: { in: ["INVESTMENT", "CRYPTO"] } },
        select: { id: true, name: true, holdings: { select: { id: true, ticker: true }, orderBy: { ticker: "asc" } } },
        orderBy: { name: "asc" },
      }),
      prisma.category.findMany({
        where: { budgetCents: { not: null } },
        select: { id: true, name: true, budgetCents: true },
        orderBy: { name: "asc" },
      }),
      getTranslations(),
    ]);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
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
          <AddInstitutionDialog modules={woobModules} dedicatedEnvNames={dedicatedSyncNames} />
        </div>

        {institutions.length === 0 ? (
          <EmptyState
            icon={Settings}
            title={t("settings.institutions.emptyTitle")}
            description={t("settings.institutions.emptyDescription")}
            action={<AddInstitutionDialog modules={woobModules} dedicatedEnvNames={dedicatedSyncNames} />}
          />
        ) : (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
            {institutions.map((inst) => (
              <div
                key={inst.id}
                className="px-5 py-3.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
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
                        <span className="ml-2 text-[var(--accent-text)]">· {t("settings.institutions.openBanking")}</span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* GoCardless Open Banking */}
                  {gcConfigured && (
                    inst.gocardlessInstitutionId
                      ? inst.accounts.some((a) => a.gocardlessAccountId)
                        ? <SyncOpenBankingButton institutionId={inst.id} />
                        : <ConnectOpenBankingButton institutionId={inst.id} />
                      : <ConnectOpenBankingDialog institutionId={inst.id} institutionName={inst.name} />
                  )}
                  {/* Woob sync - not gated by institution name (no more
                      DEDICATED_SYNC_INSTITUTIONS name-based guard). Institution.name
                      is globally unique, and picking a bank from the catalog
                      auto-fills this exact name (e.g. "LCL"), so a user-created
                      Woob-configured institution routinely collides with the
                      seeded reference row's name - name-matching silently hid
                      every one of these controls (including ConfigureWoobDialog
                      itself) for any institution literally named "LCL"/"Trade
                      Republic", real Woob credentials or not. The env-configured
                      dedicated LCL/TR path above is entirely independent of any
                      Institution row (keyed by env vars + fixed syncStatus
                      source strings), so nothing here needs to special-case it -
                      inst.woobModule being set is already the correct, unambiguous
                      signal for "this institution has real Woob sync to manage". */}
                  {(() => {
                    const woobLog = syncStatus[`woob:${inst.id}`] ?? null;
                    return (
                      <>
                        {inst.woobModule && woobLog && (
                          <output
                            className={`flex items-center gap-1 text-xs ${
                              woobLog.status === "success" ? "text-[var(--positive)]" :
                              woobLog.status === "auth_required" ? "text-[var(--warning)]" :
                              "text-[var(--negative)]"
                            }`}
                            aria-label={
                              woobLog.status === "success"
                                ? t("syncStatus.success")
                                : woobLog.status === "auth_required"
                                ? t("syncStatus.authRequired")
                                : t("syncStatus.error")
                            }
                          >
                            {woobLog.status === "success"
                              ? <CheckCircle size={12} aria-hidden="true" />
                              : <AlertTriangle size={12} aria-hidden="true" />}
                          </output>
                        )}
                        {inst.woobModule && !woobLog && (
                          <Clock size={12} className="text-[var(--muted)]" role="status" aria-label={t("syncStatus.neverSynced")} />
                        )}
                        {inst.woobModule && <InstitutionSyncButton institutionId={inst.id} />}
                        {inst.woobModule && <WoobSetupPrompt institutionId={inst.id} log={woobLog} />}
                        <ConfigureWoobDialog
                          institutionId={inst.id}
                          institutionName={inst.name}
                          currentModule={inst.woobModule}
                          modules={woobModules}
                          hasDedicatedEnvSync={dedicatedSyncNames.has(inst.name.toLowerCase())}
                          legacyAccountCount={inst.accounts.filter((a) => a.syncId?.startsWith("lcl:") || a.syncId?.startsWith("tr:")).length}
                          woobAccountCount={inst.accounts.filter((a) => a.syncId?.startsWith(`woob:${inst.id}:`)).length}
                          onMigrate={migrateDedicatedSyncToWoob.bind(null, inst.id)}
                        />
                      </>
                    );
                  })()}
                  <DeleteButton
                    label={t("common.delete")}
                    description={t("deleteInstitution.description", { name: inst.name })}
                    onDelete={deleteInstitution.bind(null, inst.id)}
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

      {/* Language */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">{t("settings.language.title")}</h2>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
          <LanguageSwitcher />
        </div>
      </section>

      {/* Auto-sync - hidden in demo mode (no real credentials, mutations blocked).
          Each card is further gated on its own .env credential actually being
          set (LCL_LOGIN / TR_PHONE) - these are the dedicated, .env-configured
          LCL/Trade Republic paths (see "Sync service - optional modules" in
          CLAUDE.md), distinct from an institution named "LCL" or "Trade
          Republic" added via the generic Woob flow below. Without this gate,
          both cards rendered unconditionally with "Jamais synchronisé" even
          on a fresh install with zero bank credentials configured anywhere -
          confusing on its own, and doubly so once a user adds their own
          Woob-configured "LCL" institution, which then shows as a second,
          differently-behaving "LCL" surface on the same page. The whole
          section disappears when neither is configured, rather than showing
          an empty header. */}
      {process.env.DEMO_MODE !== "true" && (!!process.env.LCL_LOGIN || !!process.env.TR_PHONE) && (
        <section className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">{t("settings.sync.title")}</h2>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {t(process.env.TR_PHONE ? "settings.sync.subtitle" : "settings.sync.subtitleNoTr")}
            </p>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-5 divide-y divide-[var(--border)]">
            {!!process.env.LCL_LOGIN && (
              <SyncStatus
                source="lcl"
                label="LCL"
                log={syncStatus["lcl"] ?? null}
              />
            )}
            {!!process.env.TR_PHONE && (
              <SyncStatus
                source="trade-republic"
                label="Trade Republic"
                log={syncStatus["trade_republic"] ?? null}
              />
            )}
          </div>
        </section>
      )}

      {/* Backup & restore - hidden in demo mode (restore mutations are blocked anyway) */}
      {process.env.DEMO_MODE !== "true" && <BackupRestoreSection />}

      {/* 2FA - meaningless without built-in auth active, and hidden in demo
          mode (setup/disable mutations are blocked anyway) */}
      {process.env.AUTH_ENABLED === "true" && process.env.DEMO_MODE !== "true" && (
        <TwoFactorSection totpEnabled={userSettings.totpEnabled} />
      )}

      {/* Read-only share links - deliberately NOT gated by AUTH_ENABLED like
          2FA above: this is meant to work independently of it (the primary
          use case is sharing one view externally while AUTH_ENABLED stays
          off for the trusted private network). Hidden in demo mode only
          (create/revoke mutations are blocked anyway). */}
      {process.env.DEMO_MODE !== "true" && <ShareLinksSection links={shareLinks} />}

      {/* Alerts - split into "how" (channels) and "what" (triggers) so each
          concern gets its own card and Save button, instead of one long
          mixed form. Hidden in demo mode (mutations are blocked anyway, and
          a demo instance shouldn't be sending real notifications). */}
      {process.env.DEMO_MODE !== "true" && <AlertChannelsSection settings={userSettings} />}
      {process.env.DEMO_MODE !== "true" && <AlertTriggersSection settings={userSettings} />}

      {/* Custom alert rules - same demo-mode gating as the two sections above. */}
      {process.env.DEMO_MODE !== "true" && (
        <AlertRulesSection
          rules={alertRules}
          fiatAccounts={fiatAccounts}
          investmentAccounts={investmentAccounts}
          categories={budgetCategories}
        />
      )}

    </div>
  );
}
