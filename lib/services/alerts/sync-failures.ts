/**
 * Everything that manages a `SyncFailureState` row: the edge-triggered
 * sync-failure alerts, and the sector-data health probe that reuses the same
 * machinery under a reserved source key.
 *
 * Split out of app/api/alerts/check/route.ts at v2.10.3, where 846 lines had
 * been flagged by five audits running - and where, by this repo's own layering
 * rule, none of it belonged: a route handler is meant to be the thin edge over
 * logic that lives in lib/. Text moved, nothing else.
 */
import { prisma } from "@/lib/db/prisma";
import type { UserSettingsModel } from "@/app/generated/prisma/models";
import { classifySyncSource, SYNC_STATUS_CAPTCHA_REQUIRED } from "@/lib/domain/sync-status";
import { dispatchAlert } from "@/lib/services/notifications";
import { probeYahooSectorHealth } from "@/lib/services/yahoo-finance";
import {
  isPerUserTrSource,
  isRealtimeSource,
  sourceInstitutionId,
  SOURCE_LCL,
  SOURCE_TRADE_REPUBLIC,
} from "@/lib/domain/sync-sources";

// SyncLog.source stays a machine key - it is also SyncFailureState's dedup
// key - and is resolved to something readable only here, at notification time.
// A raw cuid in a push notification tells the user nothing.
const FIXED_SOURCE_LABELS: Record<string, string> = {
  trade_republic: "Trade Republic",
  lcl: "LCL",
  // Not a bank sync: the sector-data health probe reuses this machinery.
  yahoo_sector_data: "Données sectorielles Yahoo Finance",
};

export type InstitutionLite = { id: string; name: string; woobModule: string | null; trPhone: string | null };

export function friendlySourceLabel(source: string, institutions: Map<string, InstitutionLite>): string {
  if (FIXED_SOURCE_LABELS[source]) return FIXED_SOURCE_LABELS[source];
  // Through the shared parser, never a per-prefix branch: a `woob:`-only one
  // let per-user Trade Republic sources fall through and be announced by their
  // raw cuid.
  const institutionId = sourceInstitutionId(source);
  if (institutionId) {
    const institution = institutions.get(institutionId);
    if (institution) return institution.name;
    // The institution was deleted and the source string still carries its id.
    // Generic beats leaking the id; the orphaned row needs cleanup in Settings.
    return isPerUserTrSource(source) ? "Trade Republic" : "une banque configurée via Woob";
  }
  return source;
}

// A retired source never writes another success row, so nothing would ever
// clear its SyncFailureState and it reminds forever: .env credentials removed,
// or an Institution deleted / its config cleared. Checked every run, not only
// at alert-creation time, so one retired AFTER its state row exists is cleaned
// up too.
export function isSourceRetired(source: string, institutions: Map<string, InstitutionLite>): boolean {
  if (source === SOURCE_LCL) return !process.env.LCL_LOGIN;
  if (source === SOURCE_TRADE_REPUBLIC) return !process.env.TR_PHONE;
  const institutionId = sourceInstitutionId(source);
  if (institutionId) {
    const institution = institutions.get(institutionId);
    // Retired once the institution is gone, or once the provider this source
    // belongs to has been cleared from it. Checking the matching provider
    // rather than Woob's alone matters: a per-user Trade Republic connection
    // that was removed used to keep reminding "still broken" every 24h with
    // no way to ever clear itself, the same dead end this function was
    // written for when LCL_LOGIN was removed from .env.
    if (!institution) return true;
    const isTradeRepublic = isPerUserTrSource(source) || isRealtimeSource(source);
    return isTradeRepublic ? !institution.trPhone : !institution.woobModule;
  }
  return false;
}

// Deliberately does not surface the raw SyncLog.message - it's Python
// exception text aimed at someone running the sync container's CLI
// ("Session web absente - lance --setup", "Certicode Plus requis - lance
// --setup"), not a notification a phone should show. A user flagged this
// directly: alerts need to read as "sobre et claire", not a raw error log.
// The two states the app actually distinguishes (auth_required vs a plain
// sync error) are enough to say something clear and actionable; the exact
// technical detail is still in Paramètres → sync status / SyncLog for
// anyone who wants to dig further.
export function formatSyncFailureBody(label: string, status: string): string {
  if (status === SYNC_STATUS_CAPTCHA_REQUIRED) {
    // Says what to do AND why it will not stop happening, because this one
    // never resolves itself - see lib/domain/sync-status.ts. Sent once only.
    return `"${label}" demande un captcha : ouvre Paramètres et clique sur « Se connecter » pour le résoudre. La synchronisation automatique ne peut pas le faire à ta place.`;
  }
  if (status === "auth_required") {
    return `La connexion à "${label}" a expiré. Reconnecte-toi depuis Paramètres.`;
  }
  return `La synchronisation de "${label}" a rencontré un problème. Vérifie les journaux de synchro si ça persiste.`;
}

const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Edge-triggered, never level-triggered: one alert when a source enters a
 * broken streak, one reminder per REMINDER_INTERVAL_MS while it stays broken,
 * cleared on the next success. Alerting per failed SyncLog row instead sends
 * hundreds of emails in minutes once a source has been broken a while.
 */
async function clearSyncFailureState(userId: string, source: string, hasState: boolean): Promise<void> {
  if (hasState) await prisma.syncFailureState.delete({ where: { userId_source: { userId, source } } });
}

type SourceGroup = { source: string; _max: { createdAt: Date | null } };

/**
 * Everything checkSyncFailures's loop needs, in three queries instead of three
 * per source.
 *
 * It used to run a findFirst, a findUnique and (inside isSourceRetired) an
 * institution lookup for every source, sequentially, inside a route that
 * already loops per user - so the cost grew as users × sources. Extracted
 * rather than inlined because this file is already the one flagged as the next
 * to split, and because the loop that consumes this is quite complex enough on
 * its own.
 */
async function loadSyncFailureContext(userId: string, groups: SourceGroup[]) {
  const pairs = groups
    .filter((g) => g._max.createdAt)
    .map((g) => ({ source: g.source, createdAt: g._max.createdAt as Date }));

  const institutionIds = [
    ...new Set(pairs.map((p) => sourceInstitutionId(p.source)).filter((id): id is string => !!id)),
  ];

  const [logRows, stateRows, institutions] = await Promise.all([
    pairs.length
      ? prisma.syncLog.findMany({ where: { userId, OR: pairs }, orderBy: { id: "desc" } })
      : Promise.resolve([]),
    prisma.syncFailureState.findMany({ where: { userId } }),
    institutionIds.length
      ? prisma.institution.findMany({
          where: { id: { in: institutionIds } },
          select: { id: true, name: true, woobModule: true, trPhone: true },
        })
      : Promise.resolve([]),
  ]);

  // orderBy id desc above, so the first row seen for a source is the one the
  // per-source findFirst used to return.
  const latestBySource = new Map<string, (typeof logRows)[number]>();
  for (const row of logRows) if (!latestBySource.has(row.source)) latestBySource.set(row.source, row);

  return {
    latestBySource,
    stateBySource: new Map(stateRows.map((r) => [r.source, r])),
    institutionById: new Map(institutions.map((i) => [i.id, i])),
  };
}

export async function checkSyncFailures(settings: UserSettingsModel): Promise<string[]> {
  if (!settings.syncFailureAlertsEnabled) return [];

  // Only ever looks at each source's single most recent SyncLog row - older
  // rows are irrelevant to "is it broken right now".
  // Scoped to this user's own sync sources (v2.0) - a Woob source belongs to
  // whoever owns the institution, and the env-driven lcl/trade_republic
  // sources belong to the owner, so one user's broken bank never alerts
  // another.
  const latestPerSource = await prisma.syncLog.groupBy({
    by: ["source"],
    where: { userId: settings.userId },
    _max: { createdAt: true },
  });

  const { latestBySource, stateBySource, institutionById } = await loadSyncFailureContext(
    settings.userId,
    latestPerSource,
  );

  const fired: string[] = [];

  for (const { source, _max } of latestPerSource) {
    if (!_max.createdAt) continue;
    // A real-time listener reports on the same Trade Republic session its
    // batch sync uses, so a dead session makes both fail - and only the batch
    // sync's alert names something the user recognises and can act on. The
    // listener's own copy arrived titled "trade_republic_realtime", which
    // names nothing. Its SyncLog rows stay, and stay visible in Settings;
    // the verdict below suppresses the duplicate notification, not the
    // diagnosis.
    const latest = latestBySource.get(source);
    if (!latest) continue;
    const state = stateBySource.get(source) ?? null;

    // Every reason to skip a source, in one decision rather than five guards
    // stacked in front of the alerting. See lib/domain/sync-status.ts for what
    // each verdict means and why; the two facts it cannot know for itself are
    // computed here and handed in.
    const verdict = classifySyncSource({
      status: latest.status,
      isRetired: isSourceRetired(source, institutionById),
      isRealtime: isRealtimeSource(source),
      hasState: !!state,
    });
    if (verdict === "silent") continue;
    if (verdict === "clear") {
      // Deletes a row an earlier version may already have created rather than
      // only skipping ahead: left behind, it would sit in the table forever
      // with nothing left to ever clear it.
      await clearSyncFailureState(settings.userId, source, !!state);
      continue;
    }

    if (!state) {
      await prisma.syncFailureState.create({ data: { userId: settings.userId, source } });
      const label = friendlySourceLabel(source, institutionById);
      await dispatchAlert(settings, "Échec de synchronisation", formatSyncFailureBody(label, latest.status));
      fired.push(source);
    } else if (Date.now() - state.lastAlertedAt.getTime() >= REMINDER_INTERVAL_MS) {
      await prisma.syncFailureState.update({
        where: { userId_source: { userId: settings.userId, source } },
        data: { lastAlertedAt: new Date() },
      });
      const label = friendlySourceLabel(source, institutionById);
      await dispatchAlert(
        settings,
        "Échec de synchronisation (toujours en cours)",
        formatSyncFailureBody(label, latest.status)
      );
      fired.push(source);
    }
  }

  return fired;
}

const SECTOR_DATA_SOURCE = "yahoo_sector_data";

/**
 * Degradation alert for the sector-exposure chart's Yahoo crumb path. Same
 * edge-triggered shape as checkSyncFailures, but manages its own
 * SyncFailureState row under a reserved key - nothing writes a SyncLog row for
 * this JS-only concern, so that loop would never find it.
 *
 * Alerts on `!anyPathHealthy`, not `!yahooHealthy`: a working fallback means
 * the feature has not stopped working.
 */
export async function checkSectorDataHealth(settings: UserSettingsModel): Promise<string[]> {
  if (!settings.sectorDataAlertsEnabled) return [];

  const { anyPathHealthy } = await probeYahooSectorHealth();
  // Yahoo's health is an instance-wide fact, but the dedup state is still
  // per-user: each user opted into this alert separately, so each gets their
  // own "already told you" bookkeeping rather than the first user's check
  // silencing everyone else's.
  const state = await prisma.syncFailureState.findUnique({
    where: { userId_source: { userId: settings.userId, source: SECTOR_DATA_SOURCE } },
  });

  if (anyPathHealthy) {
    await clearSyncFailureState(settings.userId, SECTOR_DATA_SOURCE, !!state);
    return [];
  }

  const body =
    "La récupération des données de répartition sectorielle (Analytique) depuis Yahoo Finance a échoué. " +
    "Configure une clé API de secours (FMP_API_KEY ou ALPHA_VANTAGE_API_KEY) pour plus de résilience.";

  if (!state) {
    await prisma.syncFailureState.create({ data: { userId: settings.userId, source: SECTOR_DATA_SOURCE } });
    await dispatchAlert(settings, "Données sectorielles indisponibles", body);
    return [SECTOR_DATA_SOURCE];
  }
  if (Date.now() - state.lastAlertedAt.getTime() >= REMINDER_INTERVAL_MS) {
    await prisma.syncFailureState.update({
      where: { userId_source: { userId: settings.userId, source: SECTOR_DATA_SOURCE } },
      data: { lastAlertedAt: new Date() },
    });
    await dispatchAlert(settings, "Données sectorielles indisponibles (toujours en cours)", body);
    return [SECTOR_DATA_SOURCE];
  }
  return [];
}
