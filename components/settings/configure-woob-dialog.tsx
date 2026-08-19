"use client";

import { useState, useTransition } from "react";
import { Settings2, RefreshCw, Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
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
}

export function ConfigureWoobDialog({ institutionId, institutionName, currentModule, modules }: Readonly<Props>) {
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
        <p className="text-xs text-[var(--muted)]">{t("woobHint")}</p>

        <div className="space-y-1.5">
          <Select
            id="woob-module"
            label={t("module")}
            value={module}
            onChange={(e) => setModule(e.target.value)}
            required
            options={[
              { value: "", label: t("select") },
              ...modules.map((m) => ({ value: m.module, label: m.label })),
              { value: "__custom__", label: t("other") },
            ]}
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
