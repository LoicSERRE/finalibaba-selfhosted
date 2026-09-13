import { CheckCircle, AlertTriangle, Ban, Clock } from "lucide-react";
import { getTranslations } from "next-intl/server";
import {
  syncStatusTone,
  syncStatusLabelKey,
  reconnectOnlyRefreshes,
  SYNC_STATUS_SUCCESS,
  type SyncStatusTone,
} from "@/lib/domain/sync-status";
import { isLegacyEnvSyncId, isPerUserSyncId } from "@/lib/domain/sync-ids";
import { getInstitutionLogoUrl } from "@/lib/domain/institutions";
import { deleteInstitution, migrateDedicatedSyncToWoob, adoptDedicatedTrAccounts } from "@/lib/actions/institutions";
import type { WoobBankModule } from "@/lib/actions/sync";
import { DeleteButton } from "@/components/shared/delete-button";
import { InstitutionLogo } from "@/components/shared/institution-logo";
import { ConnectOpenBankingButton, SyncOpenBankingButton, DisconnectOpenBankingButton } from "@/components/settings/open-banking-buttons";
import { ConnectOpenBankingDialog } from "@/components/settings/connect-open-banking-dialog";
import { ConfigureWoobDialog } from "@/components/settings/configure-woob-dialog";
import { InstitutionSyncButton } from "@/components/settings/institution-sync-button";
import { WoobSetupPrompt } from "@/components/settings/woob-setup-prompt";
import { TradeRepublicSetupPrompt } from "@/components/settings/tr-setup-prompt";
import { RealtimeIndicator } from "@/components/settings/realtime-indicator";

/**
 * One institution's row in Settings - the logo, the account count, and the
 * whole action cluster that differs by which sync backend (if any) reaches
 * this bank.
 *
 * Extracted from app/settings/page.tsx, where it was the single most complex
 * thing on the page: an anonymous function inside a `.map()` carrying every
 * sync-status concern in the file. Everything that moved with it - the tone
 * table, the icon table, and the four `sync-status` predicates - is used
 * nowhere else, so the page no longer imports any of it.
 *
 * A server component, like the page it came from: it awaits its own
 * translations and renders Server Actions bound to this institution's id.
 */

// Paired with lib/domain/sync-status.ts's syncStatusTone: one row per tone, so
// a new status picks up a colour and an icon by classifying itself rather than
// by being added to three separate ternary chains (which is what this replaced).
const SYNC_TONE_CLASS: Record<SyncStatusTone, string> = {
  success: "text-[var(--positive)]",
  warning: "text-[var(--warning)]",
  // Muted, not red: red invites retrying something that can never work.
  muted: "text-[var(--muted)]",
  negative: "text-[var(--negative)]",
};

const SYNC_TONE_ICON: Record<SyncStatusTone, React.ReactElement> = {
  success: <CheckCircle size={12} aria-hidden="true" />,
  warning: <AlertTriangle size={12} aria-hidden="true" />,
  muted: <Ban size={12} aria-hidden="true" />,
  negative: <AlertTriangle size={12} aria-hidden="true" />,
};

/**
 * Structural, not the generated Prisma model: the row only ever reads these
 * fields, and naming them here is what lets the page hand over the result of
 * its own `include` without either side importing the other's query shape.
 *
 * Written as a plain object type rather than this file's usual
 * `Readonly<{...}>`, and that is load-bearing rather than a style slip: lizard
 * - which `quality.yml`'s complexity ratchet runs - loses its brace balance on
 * a top-level `type X = Readonly<{...}>` alias and then reports ZERO functions
 * for the whole file, at no exit code and no warning. Measured on this very
 * file: the first draft came back `function_cnt 0`, which reads exactly like a
 * file with nothing complex in it. `readonly` per field says the same thing
 * and parses.
 */
export type InstitutionRowData = {
  readonly id: string;
  readonly name: string;
  readonly logoUrl: string | null;
  readonly gocardlessInstitutionId: string | null;
  readonly woobModule: string | null;
  readonly trPhone: string | null;
  readonly _count: { accounts: number };
  readonly accounts: readonly { syncId: string | null; gocardlessAccountId: string | null }[];
};

/** The two SyncLog fields this row reads, so neither side imports the model. */
type SyncLogSummary = { readonly status: string; readonly message: string | null };

/** getMigrationHistoryDepth's result, fetched by the page only when it matters. */
type MigrationHistoryDepth = { readonly legacyOldest: Date | null; readonly woobOldest: Date | null };

export async function InstitutionRow({
  institution: inst,
  syncLog,
  realtimeState,
  woobModules,
  dedicatedEnvNames,
  gcConfigured,
  historyDepth,
}: Readonly<{
  institution: InstitutionRowData;
  /** This institution's latest sync log, already resolved by the caller. */
  syncLog: SyncLogSummary | null;
  /** Whether this connection holds a live real-time websocket right now. */
  realtimeState: string | undefined;
  woobModules: WoobBankModule[];
  dedicatedEnvNames: ReadonlySet<string>;
  /** Whether this instance has GoCardless credentials at all. */
  gcConfigured: boolean;
  historyDepth: MigrationHistoryDepth | null;
}>) {
  const t = await getTranslations();
  const hasGocardlessAccount = inst.accounts.some((a) => a.gocardlessAccountId);

  return (
    <div className="px-5 py-3.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <InstitutionLogo
            name={inst.name}
            logoUrl={inst.logoUrl ?? getInstitutionLogoUrl(inst.name)}
            size={32}
          />
          <div>
            <p className="text-sm font-medium text-[var(--foreground)]">{inst.name}</p>
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
          <OpenBankingControls
            institutionId={inst.id}
            institutionName={inst.name}
            gocardlessInstitutionId={inst.gocardlessInstitutionId}
            hasGocardlessAccount={hasGocardlessAccount}
            configured={gcConfigured}
          />
          <SyncBackendControls
            institution={inst}
            syncLog={syncLog}
            realtimeState={realtimeState}
            woobModules={woobModules}
            dedicatedEnvNames={dedicatedEnvNames}
            historyDepth={historyDepth}
          />
          <DeleteButton
            iconOnly
            label={t("common.delete")}
            description={t("deleteInstitution.description", { name: inst.name })}
            onDelete={deleteInstitution.bind(null, inst.id)}
          />
        </div>
      </div>
      {/* The sync message, in plain sight rather than in a title attribute
          nobody hovers and no phone can reach. Reported as "no error but sync
          is not ok" (issue #54): the status was a bare icon, so a bank that had
          failed said nothing about why. It also carries the instruction a
          captcha bank depends on - that refreshing it means clicking Connect,
          not Synchronize. */}
      {syncLog?.message && syncLog.status !== SYNC_STATUS_SUCCESS && (
        <p
          className={`mt-2 text-xs ${
            syncStatusTone(syncLog.status) === "negative" ? "text-[var(--negative)]" : "text-[var(--muted)]"
          }`}
        >
          {syncLog.message}
        </p>
      )}
    </div>
  );
}

/**
 * The GoCardless (PSD2 Open Banking) half of the row. Separate from the Woob /
 * Trade Republic half below because the two are genuinely independent
 * mechanisms that happen to share a row: an institution can have either, both
 * or neither, and neither block knows anything about the other's state.
 */
function OpenBankingControls({
  institutionId,
  institutionName,
  gocardlessInstitutionId,
  hasGocardlessAccount,
  configured,
}: Readonly<{
  institutionId: string;
  institutionName: string;
  gocardlessInstitutionId: string | null;
  hasGocardlessAccount: boolean;
  /** Whether this instance has GOCARDLESS_SECRET_ID set at all. */
  configured: boolean;
}>) {
  return (
    <>
      {/* GoCardless Open Banking */}
      {configured && (
        gocardlessInstitutionId
          ? hasGocardlessAccount
            ? <SyncOpenBankingButton institutionId={institutionId} />
            : <ConnectOpenBankingButton institutionId={institutionId} />
          : <ConnectOpenBankingDialog institutionId={institutionId} institutionName={institutionName} />
      )}
      {/* Dangling GoCardless link cleanup - deliberately NOT gated on the
          `configured` flag, unlike the block above. Real gap found in
          production: an institution with gocardlessInstitutionId set but
          no actual gocardlessAccountId-linked account (an abandoned
          connection attempt) kept showing the "· Open Banking" badge
          forever with zero way to act on it once GOCARDLESS_SECRET_ID was
          removed from this instance's env - every GoCardless button above
          disappears in that state, but the badge doesn't. Refuses
          server-side if any account for this institution already has a
          real gocardlessAccountId, so it can never be used to hide an
          actually-working sync. */}
      {gocardlessInstitutionId && !hasGocardlessAccount && (
        <DisconnectOpenBankingButton institutionId={institutionId} />
      )}
    </>
  );
}

/**
 * The per-user sync half of the row: Woob or Trade Republic, never both.
 *
 * Every branch here answers one of two questions - is this connection
 * configured, and what did its last run say - so they sit together rather than
 * being spread through the row's layout.
 */
async function SyncBackendControls({
  institution: inst,
  syncLog,
  realtimeState,
  woobModules,
  dedicatedEnvNames,
  historyDepth,
}: Readonly<{
  institution: InstitutionRowData;
  syncLog: SyncLogSummary | null;
  realtimeState: string | undefined;
  woobModules: WoobBankModule[];
  dedicatedEnvNames: ReadonlySet<string>;
  historyDepth: MigrationHistoryDepth | null;
}>) {
  const t = await getTranslations();

  // v2.1 added a second per-user provider alongside Woob: Trade Republic,
  // signalled by inst.trPhone the way Woob is by inst.woobModule. An
  // institution carries at most one of the two (each config action clears the
  // other's fields, see setWoobConfig/setTradeRepublicConfig), so the status
  // icon, sync button and setup prompt are shared between them and only the
  // sync-log key - resolved by the caller - and the setup prompt's own
  // component differ.
  const isTr = !!inst.trPhone;
  const isWoob = !isTr && !!inst.woobModule;
  const configured = isTr || isWoob;

  return (
    <>
      {/* Woob sync - not gated by institution name (no more
          DEDICATED_SYNC_INSTITUTIONS name-based guard). Institution.name
          is globally unique, and picking a bank from the catalog
          auto-fills this exact name (e.g. "LCL"), so a user-created
          Woob-configured institution routinely collides with the seeded
          reference row's name - name-matching silently hid every one of
          these controls (including ConfigureWoobDialog itself) for any
          institution literally named "LCL"/"Trade Republic", real Woob
          credentials or not. The env-configured dedicated LCL/TR path is
          entirely independent of any Institution row (keyed by env vars +
          fixed syncStatus source strings), so nothing here needs to
          special-case it - inst.woobModule being set is already the
          correct, unambiguous signal for "this institution has real Woob
          sync to manage".

          "unsupported" is a fourth state, not a flavour of error: the bank
          cannot be driven by this integration at all (a captcha, a browser
          redirect, an action to perform on the bank's own site). Red would
          invite retrying something that can never work, so it is muted,
          and the message carries the explanation - reported in #51 as a
          raw traceback with no indication of what to do. */}
      {configured && syncLog && (
        <output
          className={`flex items-center gap-1 text-xs ${SYNC_TONE_CLASS[syncStatusTone(syncLog.status)]}`}
          title={syncLog.message ?? undefined}
          aria-label={t(`syncStatus.${syncStatusLabelKey(syncLog.status)}`)}
        >
          {SYNC_TONE_ICON[syncStatusTone(syncLog.status)]}
        </output>
      )}
      {configured && !syncLog && (
        <Clock size={12} className="text-[var(--muted)]" role="status" aria-label={t("syncStatus.neverSynced")} />
      )}
      {isTr && <RealtimeIndicator state={realtimeState} />}
      {/* Hidden on a bank only a person can refresh: the button could not
          succeed, and its failure would overwrite the connection that just
          worked. */}
      {configured && !reconnectOnlyRefreshes(syncLog?.status) && (
        <InstitutionSyncButton institutionId={inst.id} />
      )}
      {isWoob && <WoobSetupPrompt institutionId={inst.id} log={syncLog} />}
      {isTr && <TradeRepublicSetupPrompt institutionId={inst.id} log={syncLog} />}
      {/* One dialog for every backend. Trade Republic is an entry in its
          bank list rather than a button of its own: which backend reaches
          a given bank is this app's problem, not something to ask the
          user. */}
      <ConfigureWoobDialog
        institutionId={inst.id}
        institutionName={inst.name}
        currentModule={inst.woobModule}
        isTradeRepublicConfigured={isTr}
        modules={woobModules}
        hasDedicatedEnvSync={dedicatedEnvNames.has(inst.name.toLowerCase())}
        legacyAccountCount={inst.accounts.filter((a) => isLegacyEnvSyncId(a.syncId)).length}
        woobAccountCount={inst.accounts.filter((a) => isPerUserSyncId(a.syncId, inst.id)).length}
        legacyOldestDate={historyDepth?.legacyOldest ?? null}
        woobOldestDate={historyDepth?.woobOldest ?? null}
        onMigrate={migrateDedicatedSyncToWoob.bind(null, inst.id)}
        onAdopt={adoptDedicatedTrAccounts.bind(null, inst.id)}
      />
    </>
  );
}
