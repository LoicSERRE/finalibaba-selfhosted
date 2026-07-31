"use client";

import { useState, useTransition } from "react";
import { Settings2, RefreshCw, Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { setWoobConfig, clearWoobConfig } from "@/lib/actions/institutions";
import { useTranslations } from "next-intl";

const WOOB_MODULES = [
  { module: "lcl", label: "LCL" },
  { module: "bnporc", label: "BNP Paribas" },
  { module: "caissedepargne", label: "Caisse d'Épargne" },
  { module: "societegenerale", label: "Société Générale" },
  { module: "creditagricole", label: "Crédit Agricole" },
  { module: "boursorama", label: "Boursorama" },
  { module: "fortuneo", label: "Fortuneo" },
  { module: "hellobank", label: "Hello Bank!" },
  { module: "ing", label: "ING France" },
  { module: "bforbank", label: "BforBank" },
  { module: "monabanq", label: "Monabanq" },
  { module: "hsbc", label: "HSBC France" },
  { module: "banquepostale", label: "La Banque Postale" },
  { module: "cic", label: "CIC" },
  { module: "creditdunord", label: "Crédit du Nord" },
  { module: "linxea", label: "Linxea" },
  { module: "degiro", label: "DEGIRO" },
] as const;

interface Props {
  institutionId: string;
  institutionName: string;
  currentModule?: string | null;
}

export function ConfigureWoobDialog({ institutionId, institutionName, currentModule }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [module, setModule] = useState(currentModule ?? "");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("configureWoob");
  const tc = useTranslations("common");

  const isConfigured = !!currentModule;

  const handleSubmit = (e: React.FormEvent) => {
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
              ...WOOB_MODULES.map((m) => ({ value: m.module, label: m.label })),
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
          <p className="text-xs text-[var(--muted)] opacity-70">
            {t.rich("listHint", {
              code: (chunks) => <code className="text-[var(--foreground)]">{chunks}</code>,
            })}
          </p>
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
