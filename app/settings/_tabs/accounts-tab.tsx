import { prisma } from "@/lib/db/prisma";
import { Settings } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AddInstitutionDialog } from "@/components/settings/add-institution-dialog";
import { InstitutionRow } from "@/components/settings/institution-row";
import { EmptyState } from "@/components/shared/empty-state";
import { SyncStatus } from "@/components/settings/sync-status";
import { getMigrationHistoryDepth } from "@/lib/actions/institutions";
import { getRealtimeStatus, getSyncStatus, getWoobBankModules } from "@/lib/actions/sync";
import { isLegacyEnvSyncId } from "@/lib/domain/sync-ids";
import { institutionSyncSource } from "@/lib/domain/sync-sources";
import { SECTION_CARD, SECTION_SUBTITLE, SECTION_TITLE, type SettingsTabProps } from "./context";

// Names of the dedicated .env-configured sync integrations that currently
// have real credentials set - used to warn before a user also configures
// Woob credentials on an institution of the same name. Real production
// incident: configuring Woob on the existing seeded "LCL" institution while
// LCL_LOGIN was still active created a full second set of accounts, since
// sync_lcl.py and sync_woob.py write different syncId prefixes ("lcl:..." vs
// "woob:<institutionId>:...") and can't recognize each other's rows as the
// same bank account.
function dedicatedEnvNames(): Set<string> {
  const names = new Set<string>();
  if (process.env.LCL_LOGIN) names.add("lcl");
  if (process.env.TR_PHONE) names.add("trade republic");
  return names;
}

/** Institutions, their connections, and the dedicated .env syncs. */
export async function AccountsTab({ viewer, show }: SettingsTabProps) {
  const gcConfigured = !!process.env.GOCARDLESS_SECRET_ID;
  const dedicatedSyncNames = dedicatedEnvNames();
  // The dedicated auto-sync section renders only when at least one .env
  // credential is actually set - a fresh install showed both cards stuck on
  // "Jamais synchronisé" forever otherwise.
  const hasDedicatedEnvSync = dedicatedSyncNames.size > 0;

  const [institutions, syncStatus, realtimeStatus, woobModules, t] = await Promise.all([
    prisma.institution.findMany({
      where: { userId: viewer.id },
      include: {
        _count: { select: { accounts: true } },
        // syncId is fetched for every account (not gocardless-filtered) so
        // migrateDedicatedSyncToWoob's UI can count "lcl:"/"tr:"
        // (dedicated-env) vs "woob:<id>:" (already migrated) accounts per
        // institution - see that action's own comment for why both counts
        // matter to the user before they confirm the migration.
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
    getTranslations(),
  ]);

  // History-depth check for the "Migrer maintenant" warning - only fetched for
  // institutions where the migrate button would actually be offered (legacy
  // .env accounts AND Woob-synced replacements both exist), since it is an
  // extra couple of queries per institution. Deliberately narrower than the
  // row's own isPerUserSyncId, which also accepts `tr:<id>:`: the warning only
  // ever renders behind ConfigureWoobDialog's `canMigrate = legacyAccountCount
  // > 0 && !isTradeRepublic`, because a Trade Republic institution is offered
  // the lossless adopt instead of the delete-and-resync migrate.
  const migrationCandidates = institutions.filter((inst) => {
    const legacyCount = inst.accounts.filter((a) => isLegacyEnvSyncId(a.syncId)).length;
    const woobCount = inst.accounts.filter((a) => a.syncId?.startsWith(`woob:${inst.id}:`)).length;
    return legacyCount > 0 && woobCount > 0;
  });
  const historyDepthByInstitution = new Map(
    await Promise.all(
      migrationCandidates.map(async (inst) => [inst.id, await getMigrationHistoryDepth(inst.id)] as const),
    ),
  );

  return (
    <>
      <section id="institutions" className="space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-x-3 gap-y-2">
          <div>
            <h2 className={SECTION_TITLE}>{t("settings.institutions.title")}</h2>
            <p className={SECTION_SUBTITLE}>{t("settings.institutions.subtitle")}</p>
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
          <div className={`${SECTION_CARD} divide-y divide-[var(--border)]`}>
            {institutions.map((inst) => (
              <InstitutionRow
                key={inst.id}
                institution={inst}
                syncLog={syncStatus[institutionSyncSource(inst.id, !!inst.trPhone)] ?? null}
                realtimeState={realtimeStatus?.institutions?.[inst.id]}
                woobModules={woobModules}
                dedicatedEnvNames={dedicatedSyncNames}
                gcConfigured={gcConfigured}
                historyDepth={historyDepthByInstitution.get(inst.id) ?? null}
              />
            ))}
          </div>
        )}
      </section>

      {/* Auto-sync - hidden in demo mode (no real credentials, mutations
          blocked). Each card is further gated on its own .env credential
          actually being set (LCL_LOGIN / TR_PHONE) - these are the dedicated,
          .env-configured LCL/Trade Republic paths, distinct from an
          institution named "LCL" or "Trade Republic" added via the generic
          Woob flow above. The whole section disappears when neither is
          configured, rather than showing an empty header. */}
      {show.sensitive && hasDedicatedEnvSync && (
        <section id="auto-sync" className="space-y-4">
          <div>
            <h2 className={SECTION_TITLE}>{t("settings.sync.title")}</h2>
            <p className={SECTION_SUBTITLE}>
              {t(process.env.TR_PHONE ? "settings.sync.subtitle" : "settings.sync.subtitleNoTr")}
            </p>
          </div>
          <div className={`${SECTION_CARD} px-5 divide-y divide-[var(--border)]`}>
            {!!process.env.LCL_LOGIN && (
              <SyncStatus source="lcl" label="LCL" log={syncStatus["lcl"] ?? null} />
            )}
            {!!process.env.TR_PHONE && (
              <SyncStatus source="trade-republic" label="Trade Republic" log={syncStatus["trade_republic"] ?? null} />
            )}
          </div>
        </section>
      )}
    </>
  );
}
