"use client";

import { useState, useTransition } from "react";
import { Settings2, RefreshCw, Trash2, AlertTriangle, ArrowRightLeft, CheckCircle } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WoobModulePicker } from "@/components/settings/woob-module-picker";
import { setWoobConfig, clearWoobConfig } from "@/lib/actions/institutions";
import { useTranslations } from "next-intl";

interface Props {
  institutionId: string;
  institutionName: string;
  currentModule?: string | null;
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
  // Bound Server Action (migrateDedicatedSyncToWoob, pre-bound to this
  // institution's id in app/settings/page.tsx) - deletes the "lcl:"/"tr:"
  // accounts once the "woob:"-prefixed replacements exist. Only rendered
  // when legacyAccountCount > 0; the action itself refuses to run if
  // woobAccountCount is 0, as a second, server-side guard against deleting
  // the only copy of an account's history.
  onMigrate?: () => Promise<{ deleted: number }>;
}

export function ConfigureWoobDialog({
  institutionId,
  institutionName,
  currentModule,
  modules,
  hasDedicatedEnvSync,
  legacyAccountCount = 0,
  woobAccountCount = 0,
  onMigrate,
}: Readonly<Props>) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [module, setModule] = useState(currentModule ?? "");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [migrateStep, setMigrateStep] = useState<"idle" | "confirming" | "done">("idle");
  const [migratePending, startMigrateTransition] = useTransition();
  const [migrateError, setMigrateError] = useState<string | null>(null);
  const [migratedCount, setMigratedCount] = useState(0);
  const t = useTranslations("configureWoob");
  const tc = useTranslations("common");

  const isConfigured = !!currentModule;
  // Deliberately independent of hasDedicatedEnvSync: that flag only reflects
  // whether LCL_LOGIN/TR_PHONE is *currently* set, but the whole point of
  // this migration is often reached after the user has already removed the
  // .env credentials to stop the duplication - at that point
  // hasDedicatedEnvSync is false, yet the old "lcl:"/"tr:" accounts are
  // still sitting in the DB and still need cleaning up. Gating this on
  // hasDedicatedEnvSync too would hide the fix exactly when it's needed
  // most (real production case: secrets removed first, cleanup needed
  // after).
  const canMigrate = legacyAccountCount > 0;

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
    if (!module || !login || !password) return;
    setError(null);
    startTransition(async () => {
      try {
        await setWoobConfig(institutionId, module, login, password);
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("unknownError"));
      }
    });
  };

  const handleClear = () => {
    startTransition(async () => {
      await clearWoobConfig(institutionId);
      setModule("");
      setLogin("");
      setPassword("");
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
        <p className="text-xs text-[var(--muted)]">{t("woobHint")}</p>

        <div className="space-y-1.5">
          <WoobModulePicker
            id="woob-module"
            label={t("module")}
            value={module}
            onChange={setModule}
            modules={modules}
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
          <p className="text-xs text-[var(--muted)] opacity-70">{t("listHint")}</p>
        </div>

        <Input
          id="woob-login"
          label={t("login")}
          type="text"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          placeholder={isConfigured ? t("keepExisting") : ""}
          autoComplete="username"
          required={!isConfigured}
        />

        <Input
          id="woob-password"
          label={t("password")}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={isConfigured ? t("keepExisting") : ""}
          autoComplete="current-password"
          required={!isConfigured}
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
