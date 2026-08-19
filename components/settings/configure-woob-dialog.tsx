"use client";

import { useState, useTransition } from "react";
import { Settings2, RefreshCw, Trash2, AlertTriangle } from "lucide-react";
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
}

export function ConfigureWoobDialog({ institutionId, institutionName, currentModule, modules, hasDedicatedEnvSync }: Readonly<Props>) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [module, setModule] = useState(currentModule ?? "");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("configureWoob");
  const tc = useTranslations("common");

  const isConfigured = !!currentModule;

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
      onOpenChange={(v) => { setOpen(v); setError(null); }}
      title={t("title", { name: institutionName })}
      trigger={
        <Button variant="outline" size="sm">
          <Settings2 size={12} aria-hidden="true" />
          {isConfigured ? t("configured") : t("configure")}
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {hasDedicatedEnvSync && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--warning)]/10 border border-[var(--warning)]/40">
            <AlertTriangle size={14} className="text-[var(--warning)] shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-xs text-[var(--warning)]">{t("dedicatedEnvWarning")}</p>
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
