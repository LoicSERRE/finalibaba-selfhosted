export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db/prisma";
import { getViewer, baseAccountIds, isAuthEnabled, OWNER_USER_ID } from "@/lib/auth-context";
import { cookies } from "next/headers";
import Link from "next/link";
import { Settings, CheckCircle, AlertTriangle, Clock } from "lucide-react";
import { AddInstitutionDialog } from "@/components/settings/add-institution-dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { EmptyState } from "@/components/shared/empty-state";
import { deleteInstitution, migrateDedicatedSyncToWoob, getMigrationHistoryDepth, adoptDedicatedTrAccounts } from "@/lib/actions/institutions";
import { InstitutionLogo } from "@/components/shared/institution-logo";
import { getInstitutionLogoUrl } from "@/lib/domain/institutions";
import { isLegacyEnvSyncId, isPerUserSyncId } from "@/lib/domain/sync-ids";
import { ConnectOpenBankingButton, SyncOpenBankingButton, DisconnectOpenBankingButton } from "@/components/settings/open-banking-buttons";
import { ConnectOpenBankingDialog } from "@/components/settings/connect-open-banking-dialog";
import { ConfigureWoobDialog } from "@/components/settings/configure-woob-dialog";
import { InstitutionSyncButton } from "@/components/settings/institution-sync-button";
import { WoobSetupPrompt } from "@/components/settings/woob-setup-prompt";
import { TradeRepublicSetupPrompt } from "@/components/settings/tr-setup-prompt";
import { SyncStatus } from "@/components/settings/sync-status";
import { getRealtimeStatus, getSyncStatus, getWoobBankModules } from "@/lib/actions/sync";
import { RealtimeIndicator } from "@/components/settings/realtime-indicator";
import { getUserSettings, updateUserSettings } from "@/lib/actions/user-settings";
import { SaveSettingsButton } from "@/components/settings/save-settings-button";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/settings/language-switcher";
import { ThemeSwitcher } from "@/components/settings/theme-switcher";
import { BackupRestoreSection } from "@/components/settings/backup-restore-section";
import { TwoFactorSection } from "@/components/settings/two-factor-section";
import { AppLockSection } from "@/components/settings/app-lock-section";
import { getAppLockStatus } from "@/lib/actions/app-lock";
import { resolveThemePreference } from "@/lib/domain/theme";
import { ShareLinksSection } from "@/components/settings/share-links-section";
import { UsersSection } from "@/components/settings/users-section";
import { AccountSection } from "@/components/settings/account-section";
import { PortfolioSharingSection } from "@/components/settings/portfolio-sharing-section";
import { listUsers, listInvitations, getOwnAccount } from "@/lib/actions/users";
import { listPortfolioGrants } from "@/lib/actions/sharing";
import { getShareLinks } from "@/lib/actions/share-links";
import { ApiKeysSection } from "@/components/settings/api-keys-section";
import { getApiKeys } from "@/lib/actions/api-keys";
import { AlertChannelsSection } from "@/components/settings/alert-channels-section";
import { WebPushSection } from "@/components/settings/web-push-section";
import { getPushStatus } from "@/lib/actions/push";
import { AlertTriggersSection } from "@/components/settings/alert-triggers-section";
import { AlertRulesSection } from "@/components/settings/alert-rules-section";
import { getAlertRules } from "@/lib/actions/alert-rules";
import { GoalsSection } from "@/components/settings/goals-section";
import { getGoals } from "@/lib/actions/goals";

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

// The GoCardless callback has always redirected back here with a ?gc= status,
// but nothing ever read it - the three outcomes (connected / error /
// already-connected-by-someone-else) were silently indistinguishable. The
// third one only became possible in v2.0 (see the H7 note in
// app/api/gocardless/callback/route.ts) and genuinely needs an explanation,
// so the banner below covers all three rather than just the new one.
const GC_STATUS_KEYS = {
  connected: { key: "gcConnected", tone: "positive" },
  error: { key: "gcError", tone: "negative" },
  "already-connected": { key: "gcAlreadyConnected", tone: "warning" },
} as const;

export default async function SettingsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ gc?: string }> }>) {
  const gcStatus = GC_STATUS_KEYS[(await searchParams).gc as keyof typeof GC_STATUS_KEYS];
  const gcConfigured = !!process.env.GOCARDLESS_SECRET_ID;
  const dedicatedSyncNames = dedicatedEnvNames();
  const theme = resolveThemePreference((await cookies()).get("THEME")?.value);

  // Settings only ever configures the viewer's OWN portfolio (pickers here
  // feed alert rules, goals and share links, all of which are per-user
  // artifacts), so these use baseAccountIds - never a granted view.
  const viewer = await getViewer();
  const accountIds = await baseAccountIds(viewer.id);

  // From User, not UserSettings. v2.0 moved TOTP onto User and left the old
  // column behind as vestigial, but this read was never moved with it - so
  // enabling 2FA worked (login asked for the code) while Settings showed
  // "Désactivée" forever, because nothing writes that column any more.
  // Reported from a real instance exactly that way.
  const viewerTotpEnabled = await prisma.user
    .findUnique({ where: { id: viewer.id }, select: { totpEnabled: true } })
    .then((u) => u?.totpEnabled ?? false);

  // Multi-user surfaces, only meaningful with auth on: in mono mode there is
  // no login, so there is nobody to invite and nobody to share with. Fetched
  // conditionally rather than rendered-and-hidden so a mono instance doesn't
  // pay for three queries it can never use.
  const isMulti = isAuthEnabled();
  const [users, invitations, grants, ownAccount] = isMulti
    ? await Promise.all([
        viewer.role === "ADMIN" ? listUsers() : Promise.resolve([]),
        viewer.role === "ADMIN" ? listInvitations() : Promise.resolve([]),
        listPortfolioGrants(),
        getOwnAccount(),
      ])
    : [[], [], { given: [], received: [] }, null];

  const [institutions, syncStatus, realtimeStatus, woobModules, userSettings, shareLinks, apiKeys, alertRules, fiatAccounts, investmentAccounts, budgetCategories, goals, goalEligibleAccounts, appLockStatus, pushStatus, t] =
    await Promise.all([
      prisma.institution.findMany({
        where: { userId: viewer.id },
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
      // Which Trade Republic connections hold a live websocket right now.
      // Process state, not database state - a connection can be configured and
      // still not be listening, which is exactly the gap this answers.
      getRealtimeStatus(),
      getWoobBankModules(),
      getUserSettings(),
      getShareLinks(),
      getApiKeys(),
      getAlertRules(),
      prisma.account.findMany({
        where: { id: { in: accountIds }, type: { in: ["CHECKING", "SAVINGS", "MEAL_VOUCHER"] } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      // INVESTMENT_VALUE + UNREALIZED_GAIN's account picker, and
      // HOLDING_PRICE/REBALANCING_DRIFT's holding picker (flattened from
      // these accounts' holdings in the component) - see
      // components/settings/alert-rules-section.tsx. targetPct is fetched so
      // the component can filter to only the holdings REBALANCING_DRIFT can
      // actually evaluate (see computeHoldingDriftPts's own null guard).
      prisma.account.findMany({
        where: { id: { in: accountIds }, type: { in: ["INVESTMENT", "CRYPTO"] } },
        select: {
          id: true,
          name: true,
          holdings: { select: { id: true, ticker: true, name: true, targetPct: true }, orderBy: { ticker: "asc" } },
        },
        orderBy: { name: "asc" },
      }),
      prisma.category.findMany({
        where: { userId: viewer.id, budgetCents: { not: null } },
        select: { id: true, name: true, budgetCents: true },
        orderBy: { name: "asc" },
      }),
      getGoals(),
      // A goal's linked account can be REAL_ESTATE/AUTOMOBILE too (e.g.
      // "down payment" toward a house), unlike the fiatAccounts/
      // investmentAccounts pickers above which are each scoped to a
      // narrower AlertRule kind - LOAN is the only exclusion, see
      // components/settings/goals-section.tsx and the Goal model's own
      // schema comment for why.
      prisma.account.findMany({
        where: { id: { in: accountIds }, type: { not: "LOAN" } },
        select: { id: true, name: true, type: true },
        orderBy: { name: "asc" },
      }),
      getAppLockStatus(),
      getPushStatus(),
      getTranslations(),
    ]);

  // History-depth check for the "Migrer maintenant" warning below - only
  // fetched for institutions where the migrate button would actually be
  // offered (legacy .env accounts AND Woob-synced replacements both exist),
  // not for every institution on the page, since it's an extra couple of
  // queries per institution and only matters in this one specific case.
  const migrationCandidates = institutions.filter((inst) => {
    const legacyCount = inst.accounts.filter((a) => isLegacyEnvSyncId(a.syncId)).length;
    const woobCount = inst.accounts.filter((a) => a.syncId?.startsWith(`woob:${inst.id}:`)).length;
    return legacyCount > 0 && woobCount > 0;
  });
  const historyDepthEntries = await Promise.all(
    migrationCandidates.map(async (inst) => [inst.id, await getMigrationHistoryDepth(inst.id)] as const),
  );
  const historyDepthByInstitution = new Map(historyDepthEntries);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">{t("settings.title")}</h1>
        <p className="text-sm text-[var(--muted)] mt-1">{t("settings.subtitle")}</p>
      </div>

      {gcStatus && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            gcStatus.tone === "positive"
              ? "border-[var(--positive)]/40 bg-[var(--positive)]/10 text-[var(--positive)]"
              : gcStatus.tone === "negative"
                ? "border-[var(--negative)]/40 bg-[var(--negative)]/10 text-[var(--negative)]"
                : "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]"
          }`}
        >
          {t(`settings.${gcStatus.key}` as Parameters<typeof t>[0])}
        </div>
      )}

      {/* Institutions */}
      <section className="space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-x-3 gap-y-2">
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
                  {/* Dangling GoCardless link cleanup - deliberately NOT
                      gated on gcConfigured, unlike the block above. Real gap
                      found in production: an institution with
                      gocardlessInstitutionId set but no actual
                      gocardlessAccountId-linked account (an abandoned
                      connection attempt) kept showing the "· Open Banking"
                      badge forever with zero way to act on it once
                      GOCARDLESS_SECRET_ID was removed from this instance's
                      env - every GoCardless button above disappears in that
                      state, but the badge doesn't. Refuses server-side if
                      any account for this institution already has a real
                      gocardlessAccountId, so it can never be used to hide an
                      actually-working sync. */}
                  {inst.gocardlessInstitutionId && !inst.accounts.some((a) => a.gocardlessAccountId) && (
                    <DisconnectOpenBankingButton institutionId={inst.id} />
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
                      signal for "this institution has real Woob sync to manage".

                      v2.1 added a second per-user provider alongside Woob:
                      Trade Republic, signalled by inst.trPhone the same way.
                      An institution carries at most one of the two (each
                      config action clears the other's fields, see
                      setWoobConfig/setTradeRepublicConfig), so the status
                      icon, sync button and setup prompt below are shared
                      between them and only the sync-log key and the setup
                      prompt's own component differ. */}
                  {(() => {
                    const isTr = !!inst.trPhone;
                    const isWoob = !isTr && !!inst.woobModule;
                    const configured = isTr || isWoob;
                    const syncLog = syncStatus[isTr ? `tr:${inst.id}` : `woob:${inst.id}`] ?? null;
                    return (
                      <>
                        {configured && syncLog && (
                          <output
                            className={`flex items-center gap-1 text-xs ${
                              syncLog.status === "success" ? "text-[var(--positive)]" :
                              syncLog.status === "auth_required" ? "text-[var(--warning)]" :
                              "text-[var(--negative)]"
                            }`}
                            aria-label={
                              syncLog.status === "success"
                                ? t("syncStatus.success")
                                : syncLog.status === "auth_required"
                                ? t("syncStatus.authRequired")
                                : t("syncStatus.error")
                            }
                          >
                            {syncLog.status === "success"
                              ? <CheckCircle size={12} aria-hidden="true" />
                              : <AlertTriangle size={12} aria-hidden="true" />}
                          </output>
                        )}
                        {configured && !syncLog && (
                          <Clock size={12} className="text-[var(--muted)]" role="status" aria-label={t("syncStatus.neverSynced")} />
                        )}
                        {isTr && (
                          <RealtimeIndicator state={realtimeStatus?.institutions?.[inst.id]} />
                        )}
                        {configured && <InstitutionSyncButton institutionId={inst.id} />}
                        {isWoob && <WoobSetupPrompt institutionId={inst.id} log={syncLog} />}
                        {isTr && <TradeRepublicSetupPrompt institutionId={inst.id} log={syncLog} />}
                        {/* One dialog for every backend. Trade Republic is an
                            entry in its bank list rather than a button of its
                            own: which backend reaches a given bank is this
                            app's problem, not something to ask the user. */}
                        <ConfigureWoobDialog
                          institutionId={inst.id}
                          institutionName={inst.name}
                          currentModule={inst.woobModule}
                          isTradeRepublicConfigured={isTr}
                          modules={woobModules}
                          hasDedicatedEnvSync={dedicatedSyncNames.has(inst.name.toLowerCase())}
                          legacyAccountCount={inst.accounts.filter((a) => isLegacyEnvSyncId(a.syncId)).length}
                          woobAccountCount={inst.accounts.filter((a) => isPerUserSyncId(a.syncId, inst.id)).length}
                          legacyOldestDate={historyDepthByInstitution.get(inst.id)?.legacyOldest ?? null}
                          woobOldestDate={historyDepthByInstitution.get(inst.id)?.woobOldest ?? null}
                          onMigrate={migrateDedicatedSyncToWoob.bind(null, inst.id)}
                          onAdopt={adoptDedicatedTrAccounts.bind(null, inst.id)}
                        />
                      </>
                    );
                  })()}
                  <DeleteButton
                    iconOnly
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

      {/* Savings goals (v1.14) - replaces the old single "Objectif
          patrimoine" field above. Not demo-gated, same precedent as the
          Financial profile section it supersedes - unlike alerts, a goal
          never sends a real notification, so there's nothing demo-unsafe
          about it. */}
      <GoalsSection goals={goals} accounts={goalEligibleAccounts} />

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

      {/* Theme */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">{t("settings.theme.title")}</h2>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
          <ThemeSwitcher theme={theme} />
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
      {/* Admin-only since v2.0: this wraps pg_dump/psql over the WHOLE
          database, so a restore replaces every user's data (and the user table
          itself). app/api/backup/route.ts enforces it - this just doesn't
          offer a member a section whose every button returns 403. */}
      {process.env.DEMO_MODE !== "true" && viewer.role === "ADMIN" && <BackupRestoreSection />}

      {/* 2FA - meaningless without built-in auth active, and hidden in demo
          mode (setup/disable mutations are blocked anyway) */}
      {process.env.AUTH_ENABLED === "true" && process.env.DEMO_MODE !== "true" && (
        <TwoFactorSection totpEnabled={viewerTotpEnabled} />
      )}

      {/* App-lock - deliberately NOT gated by AUTH_ENABLED like 2FA above,
          same "independent of AUTH_ENABLED" precedent as ShareLink below:
          a fast local unlock for an already-installed, already-trusted PWA,
          meant to work even on a private-network instance with no password
          login at all. Hidden in demo mode only (registration/toggle
          mutations would be blocked anyway, and a public demo has no real
          device-pairing story). */}
      {process.env.DEMO_MODE !== "true" && (
        <AppLockSection userId={viewer.id} enabled={appLockStatus.enabled} credentials={appLockStatus.credentials} />
      )}

      {/* Read-only share links - deliberately NOT gated by AUTH_ENABLED like
          2FA above: this is meant to work independently of it (the primary
          use case is sharing one view externally while AUTH_ENABLED stays
          off for the trusted private network). Hidden in demo mode only
          (create/revoke mutations are blocked anyway). */}
      {process.env.DEMO_MODE !== "true" && <ShareLinksSection links={shareLinks} />}

      {/* Read-only guests (v2.0) - sits next to share links because they answer
          the same question ("let someone else see this"), with a different
          trust model: a grant is tied to a real account on this instance and is
          revocable per person, a share link is an anonymous URL. */}
      {isMulti && ownAccount && process.env.DEMO_MODE !== "true" && (
        <AccountSection
          username={ownAccount.username}
          displayName={ownAccount.displayName}
          role={ownAccount.role}
          needsSetup={ownAccount.needsSetup}
        />
      )}

      {isMulti && process.env.DEMO_MODE !== "true" && (
        <PortfolioSharingSection given={grants.given} received={grants.received} />
      )}

      {isMulti && viewer.role === "ADMIN" && process.env.DEMO_MODE !== "true" && (
        <UsersSection
          users={users}
          invitations={invitations}
          currentUserId={viewer.id}
          ownerUserId={OWNER_USER_ID}
        />
      )}

      {/* Public REST API keys - same demo-mode gate as share links above
          (create/revoke mutations blocked anyway in demo mode), same
          "independent of AUTH_ENABLED" reasoning: proxy.ts excludes
          /api/v1 from the NextAuth matcher entirely, each route gates
          itself via the key instead. See CLAUDE.md's "Public REST API". */}
      {process.env.DEMO_MODE !== "true" && <ApiKeysSection keys={apiKeys} />}

      {/* Alerts - split into "how" (channels) and "what" (triggers) so each
          concern gets its own card and Save button, instead of one long
          mixed form. Hidden in demo mode (mutations are blocked anyway, and
          a demo instance shouldn't be sending real notifications). */}
      {process.env.DEMO_MODE !== "true" && <AlertChannelsSection settings={userSettings} />}
      {/* A 3rd channel alongside ntfy/email above, but its own section (not
          folded into AlertChannelsSection's form) since "configuring" it is
          a subscribe action on this browser, not a text field to type into
          and Save. */}
      {process.env.DEMO_MODE !== "true" && (
        <WebPushSection enabled={pushStatus.enabled} publicKey={pushStatus.publicKey} subscriptions={pushStatus.subscriptions} />
      )}
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
