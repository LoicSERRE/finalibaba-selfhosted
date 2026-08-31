"use client";

import { useMemo, useState, useTransition } from "react";
import { Settings2, RefreshCw, Trash2, AlertTriangle, ArrowRightLeft, CheckCircle } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WoobModulePicker } from "@/components/settings/woob-module-picker";
import {
  setWoobConfig,
  clearWoobConfig,
  setTradeRepublicConfig,
  clearTradeRepublicConfig,
} from "@/lib/actions/institutions";
import { historyDepthLossDays } from "@/lib/domain/institutions";
import {
  TRADE_REPUBLIC_MODULE,
  bankPickerEntries,
  isTradeRepublicModule,
} from "@/lib/domain/sync-providers";
import { useTranslations } from "next-intl";

/**
 * Configure how one institution syncs - whichever backend reaches it.
 *
 * Named for Woob because that was the only per-user backend when it was
 * written; v2.1 added Trade Republic to the same bank list rather than giving
 * it a button of its own, since which backend a bank needs is not something
 * the person adding their bank should have to know or choose.
 */
interface Props {
  institutionId: string;
  institutionName: string;
  currentModule?: string | null;
  /** True when this institution already holds Trade Republic credentials.
   *  Never true at the same time as currentModule: the two config actions
   *  each clear the other's fields. */
  isTradeRepublicConfigured?: boolean;
  // Every Woob module capable of bank sync (~96, fetched live from Woob's
  // repository by getWoobBankModules() and passed down from
  // app/settings/page.tsx) - falls back to a small fixed list of major
  // French banks when the sync service can't be reached (see that action's
  // own comment). "Autre" below stays as an escape hatch for anything not
  // tagged CapBank, or genuinely missing from the catalog (e.g. Revolut -
  // confirmed absent from Woob entirely, not just this list).
  modules: { module: string; label: string }[];
  // True when this institution's name matches a dedicated .env-configured
  // integration (LCL_LOGIN/TR_PHONE) that's currently active - see
  // app/settings/page.tsx's dedicatedEnvNames(). Real incident: configuring
  // Woob here on top of an already-running dedicated sync created a full
  // second set of accounts, since the two paths write different syncId
  // prefixes and can't recognize each other's rows as the same bank
  // account - warned here rather than blocked, since a deliberate,
  // supervised migration (delete the old accounts afterward) is legitimate.
  hasDedicatedEnvSync?: boolean;
  // How many of this institution's accounts still carry the dedicated
  // sync's "lcl:"/"tr:" syncId prefix, and how many already carry Woob's
  // "woob:<institutionId>:" prefix - computed server-side in
  // app/settings/page.tsx from the same accounts list already fetched for
  // the institution row. Both are shown to the user before they confirm a
  // migration (see onMigrate below), since a mismatch between the two
  // counts is the one thing that can catch a partial/incomplete Woob sync
  // before it causes real data loss.
  legacyAccountCount?: number;
  woobAccountCount?: number;
  // Oldest Transaction/HistoricalBalance date on each side - see
  // getMigrationHistoryDepth (lib/actions/institutions.ts). Real production
  // incident: the confirmation step used to only compare account *count*
  // (5 vs 5, which matched) and never *history depth* - a user's real
  // multi-year transaction history was permanently deleted because nothing
  // warned that the Woob side had only just started accumulating its own.
  // Both null when the depth check doesn't apply (not a dedicated-sync
  // institution, or nothing synced yet on one side).
  legacyOldestDate?: Date | null;
  woobOldestDate?: Date | null;
  // Bound Server Action (migrateDedicatedSyncToWoob, pre-bound to this
  // institution's id in app/settings/page.tsx) - deletes the "lcl:"/"tr:"
  // accounts once the "woob:"-prefixed replacements exist. Only rendered
  // when legacyAccountCount > 0; the action itself refuses to run if
  // woobAccountCount is 0, as a second, server-side guard against deleting
  // the only copy of an account's history.
  onMigrate?: () => Promise<{ deleted: number }>;
  /** Bound adoptDedicatedTrAccounts. Renames the .env sync's account ids to
   *  this institution's own, keeping every account and its whole history -
   *  the lossless counterpart to onMigrate, and the only one offered for
   *  Trade Republic. */
  onAdopt?: () => Promise<{ adopted: number }>;
}

export function ConfigureWoobDialog({
  institutionId,
  institutionName,
  currentModule,
  modules,
  hasDedicatedEnvSync,
  legacyAccountCount = 0,
  woobAccountCount = 0,
  legacyOldestDate = null,
  woobOldestDate = null,
  onMigrate,
  onAdopt,
  isTradeRepublicConfigured = false,
}: Readonly<Props>) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [module, setModule] = useState(
    currentModule ?? (isTradeRepublicConfigured ? TRADE_REPUBLIC_MODULE : ""),
  );
  const [identifier, setIdentifier] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [migrateStep, setMigrateStep] = useState<"idle" | "confirming" | "done">("idle");
  const [migratePending, startMigrateTransition] = useTransition();
  const [migrateError, setMigrateError] = useState<string | null>(null);
  const [migratedCount, setMigratedCount] = useState(0);
  const [adoptedCount, setAdoptedCount] = useState<number | null>(null);
  const [adoptError, setAdoptError] = useState<string | null>(null);
  const [adoptPending, startAdoptTransition] = useTransition();
  const t = useTranslations("configureWoob");
  const tc = useTranslations("common");

  const banks = useMemo(() => bankPickerEntries(modules), [modules]);
  const isTradeRepublic = isTradeRepublicModule(module);
  const isConfigured = !!currentModule || isTradeRepublicConfigured;
  // Deliberately independent of hasDedicatedEnvSync: that flag only reflects
  // whether LCL_LOGIN/TR_PHONE is *currently* set, but the whole point of
  // this migration is often reached after the user has already removed the
  // .env credentials to stop the duplication - at that point
  // hasDedicatedEnvSync is false, yet the old "lcl:"/"tr:" accounts are
  // still sitting in the DB and still need cleaning up. Gating this on
  // hasDedicatedEnvSync too would hide the fix exactly when it's needed
  // most (real production case: secrets removed first, cleanup needed
  // after).
  // Never offered while Trade Republic is the picked provider: this migration
  // moves legacy .env-synced accounts onto Woob specifically, and refuses to
  // run until "woob:"-prefixed accounts exist - which they never will here, so
  // the block would sit there permanently saying it has nothing to work with.
  const canMigrate = legacyAccountCount > 0 && !isTradeRepublic;
  // Trade Republic gets the lossless path instead. Its four legacy ids map
  // one-to-one onto the per-user shape, so the accounts can simply be renamed
  // rather than deleted and re-synced from scratch.
  const canAdopt = legacyAccountCount > 0 && isTradeRepublic && !!onAdopt;

  const handleAdopt = () => {
    if (!onAdopt) return;
    setAdoptError(null);
    startAdoptTransition(async () => {
      try {
        const { adopted } = await onAdopt();
        setAdoptedCount(adopted);
      } catch (e) {
        setAdoptError(e instanceof Error ? e.message : t("unknownError"));
      }
    });
  };
  const historyLossDays = historyDepthLossDays(legacyOldestDate, woobOldestDate);

  const handleMigrate = () => {
    if (!onMigrate) return;
    setMigrateError(null);
    startMigrateTransition(async () => {
      try {
        const { deleted } = await onMigrate();
        setMigratedCount(deleted);
        setMigrateStep("done");
      } catch (e) {
        setMigrateError(e instanceof Error ? e.message : t("unknownError"));
      }
    });
  };

  const handleSubmit = (e: React.SubmitEvent) => {
    e.preventDefault();
    if (!module || !identifier || !secret) return;
    setError(null);
    startTransition(async () => {
      try {
        // Each action clears the other provider's fields, so switching an
        // institution from one backend to the other is a single save rather
        // than a clear-then-reconfigure.
        if (isTradeRepublic) {
          await setTradeRepublicConfig(institutionId, identifier, secret);
        } else {
          await setWoobConfig(institutionId, module, identifier, secret);
        }
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("unknownError"));
      }
    });
  };

  const handleClear = () => {
    startTransition(async () => {
      if (isTradeRepublicConfigured) {
        await clearTradeRepublicConfig(institutionId);
      } else {
        await clearWoobConfig(institutionId);
      }
      setModule("");
      setIdentifier("");
      setSecret("");
      setOpen(false);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { setOpen(v); setError(null); setMigrateStep("idle"); setMigrateError(null); }}
      title={t("title", { name: institutionName })}
      trigger={
        <Button variant="outline" size="sm">
          <Settings2 size={12} aria-hidden="true" />
          {isConfigured ? t("configured") : t("configure")}
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {canAdopt && adoptedCount === null && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)]/40">
            <ArrowRightLeft size={14} className="text-[var(--accent-text)] shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-2 flex-1">
              <p className="text-xs text-[var(--foreground)]">
                {t("adoptDescription", { count: legacyAccountCount })}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={handleAdopt} disabled={adoptPending}>
                {adoptPending && <RefreshCw size={12} className="animate-spin" aria-hidden="true" />}
                {t("adoptButton")}
              </Button>
              {adoptError && <p className="text-xs text-[var(--negative)]">{adoptError}</p>}
            </div>
          </div>
        )}

        {adoptedCount !== null && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--positive)]/10 border border-[var(--positive)]/40">
            <CheckCircle size={14} className="text-[var(--positive)] shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-xs text-[var(--positive)]">{t("adoptSuccess", { count: adoptedCount })}</p>
          </div>
        )}

        {(hasDedicatedEnvSync || canMigrate) && migrateStep !== "done" && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--warning)]/10 border border-[var(--warning)]/40">
            <AlertTriangle size={14} className="text-[var(--warning)] shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-2 flex-1">
              <p className="text-xs text-[var(--warning)]">
                {hasDedicatedEnvSync ? t("dedicatedEnvWarning") : t("legacyAccountsWarning", { count: legacyAccountCount })}
              </p>
              {canMigrate && migrateStep === "idle" && (
                woobAccountCount > 0 ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setMigrateStep("confirming")}>
                    <ArrowRightLeft size={12} aria-hidden="true" />
                    {t("migrateButton")}
                  </Button>
                ) : (
                  <p className="text-xs text-[var(--muted)]">{t("migrateNoWoobDataYet")}</p>
                )
              )}
              {canMigrate && migrateStep === "confirming" && (
                <div className="space-y-2 p-2.5 rounded-md bg-[var(--surface)] border border-[var(--border)]">
                  <p className="text-xs text-[var(--foreground)]">
                    {t("migrateConfirmDescription", { legacyCount: legacyAccountCount, woobCount: woobAccountCount })}
                  </p>
                  {historyLossDays !== null && legacyOldestDate && woobOldestDate && (
                    <p className="text-xs font-medium text-[var(--negative)]">
                      {t("historyDepthWarning", {
                        legacyDate: legacyOldestDate.toLocaleDateString(),
                        woobDate: woobOldestDate.toLocaleDateString(),
                        days: historyLossDays,
                      })}
                    </p>
                  )}
                  <p className="text-xs text-[var(--muted)]">{t("migrateEnvReminder")}</p>
                  {migrateError && <p role="alert" className="text-xs text-[var(--negative)]">{migrateError}</p>}
                  <div className="flex gap-2 justify-end pt-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => setMigrateStep("idle")} disabled={migratePending}>
                      {tc("cancel")}
                    </Button>
                    <Button type="button" variant="destructive" size="sm" onClick={handleMigrate} disabled={migratePending}>
                      {migratePending && <RefreshCw size={12} className="animate-spin" aria-hidden="true" />}
                      {t("migrateConfirmButton")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {migrateStep === "done" && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--positive)]/10 border border-[var(--positive)]/40">
            <CheckCircle size={14} className="text-[var(--positive)] shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-xs text-[var(--positive)]">{t("migrateSuccess", { count: migratedCount })}</p>
              <p className="text-xs text-[var(--muted)]">{t("migrateEnvReminder")}</p>
            </div>
          </div>
        )}
        <p className="text-xs text-[var(--muted)]">{isTradeRepublic ? t("trHint") : t("woobHint")}</p>

        <div className="space-y-1.5">
          <WoobModulePicker
            id="woob-module"
            label={t("module")}
            value={module}
            onChange={setModule}
            modules={banks}
            otherValue="__custom__"
            otherLabel={t("other")}
            placeholder={t("select")}
            searchPlaceholder={t("searchPlaceholder")}
            searchAriaLabel={t("searchAriaLabel")}
            noResultsLabel={t("noResults")}
          />
          {module === "__custom__" && (
            <Input
              type="text"
              aria-label={t("moduleAriaLabel")}
              placeholder="module_name"
              onChange={(e) => setModule(e.target.value === "__custom__" ? "" : e.target.value)}
              className="mt-1.5"
            />
          )}
          {/* Only meaningful for Woob: the hint explains its module catalogue,
              and "Autre" lets a module name be typed in by hand. Trade Republic
              is reached directly by pytr, with no module to name. */}
          {!isTradeRepublic && <p className="text-xs text-[var(--muted)] opacity-70">{t("listHint")}</p>}
        </div>

        <CredentialFields
          isTradeRepublic={isTradeRepublic}
          isConfigured={isConfigured}
          identifier={identifier}
          secret={secret}
          onIdentifier={setIdentifier}
          onSecret={setSecret}
        />

        {error && <p role="alert" className="text-xs text-[var(--negative)]">{error}</p>}

        <div className="flex items-center justify-between pt-2">
          {isConfigured && (
            <Button type="button" variant="destructive" size="sm" onClick={handleClear} disabled={pending}>
              <Trash2 size={12} aria-hidden="true" />
              {t("deleteConfig")}
            </Button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending || !module || module === "__custom__"}>
              {pending && <RefreshCw size={12} className="animate-spin" aria-hidden="true" />}
              {isConfigured ? t("update") : t("submit")}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * The two credential inputs, whichever backend they belong to.
 *
 * Extracted rather than inlined with a ternary per attribute: eight of them in
 * a row is exactly the shape that pushed the parent past its complexity
 * budget, and the pair reads as one decision ("which credentials does this
 * bank need") rather than eight independent ones.
 */
function CredentialFields({
  isTradeRepublic,
  isConfigured,
  identifier,
  secret,
  onIdentifier,
  onSecret,
}: Readonly<{
  isTradeRepublic: boolean;
  isConfigured: boolean;
  identifier: string;
  secret: string;
  onIdentifier: (v: string) => void;
  onSecret: (v: string) => void;
}>) {
  const t = useTranslations("configureWoob");
  const keepExisting = isConfigured ? t("keepExisting") : "";

  const fields = isTradeRepublic
    ? {
        identifierLabel: t("trPhone"),
        identifierPlaceholder: "+33612345678",
        secretLabel: t("trPin"),
        secretPlaceholder: "••••",
        // A phone number and a PIN are not this browser's saved credentials
        // for anything, so offering to autofill them only ever gets it wrong.
        identifierAutoComplete: "off",
        secretAutoComplete: "off",
      }
    : {
        identifierLabel: t("login"),
        identifierPlaceholder: keepExisting,
        secretLabel: t("password"),
        secretPlaceholder: keepExisting,
        identifierAutoComplete: "username",
        secretAutoComplete: "current-password",
      };

  return (
    <>
      <Input
        id="woob-login"
        label={fields.identifierLabel}
        type="text"
        value={identifier}
        onChange={(e) => onIdentifier(e.target.value)}
        placeholder={fields.identifierPlaceholder}
        autoComplete={fields.identifierAutoComplete}
        required={!isConfigured}
      />

      <Input
        id="woob-password"
        label={fields.secretLabel}
        type="password"
        value={secret}
        onChange={(e) => onSecret(e.target.value)}
        placeholder={fields.secretPlaceholder}
        autoComplete={fields.secretAutoComplete}
        required={!isConfigured}
      />
    </>
  );
}
