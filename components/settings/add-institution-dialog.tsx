"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { createInstitution } from "@/lib/actions/institutions";
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

export function AddInstitutionDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [selectedModule, setSelectedModule] = useState("");
  const [customName, setCustomName] = useState("");
  const t = useTranslations("addInstitution");
  const tc = useTranslations("common");

  const knownBank = WOOB_MODULES.find((m) => m.module === selectedModule);
  const isCustom = selectedModule === "__other__";
  const woobEnabled = !!knownBank;
  const bankOptions = [
    { value: "", label: t("select") },
    ...WOOB_MODULES.map((m) => ({ value: m.module, label: m.label })),
    { value: "__other__", label: t("other") },
  ];

  const reset = () => {
    setSelectedModule("");
    setCustomName("");
  };

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // Ensure name is set (auto from known bank or custom input)
    if (!fd.get("name")) return;
    startTransition(async () => {
      await createInstitution(fd);
      reset();
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}
      title={t("title")}
      trigger={
        <Button>
          <Plus size={14} aria-hidden="true" />
          {t("trigger")}
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Select
          id="inst-bank"
          label={t("bank")}
          value={selectedModule}
          onChange={(e) => { setSelectedModule(e.target.value); setCustomName(""); }}
          options={bankOptions}
          required
        />

        {knownBank && (
          <input type="hidden" name="name" value={knownBank.label} />
        )}

        {isCustom && (
          <Input
            id="inst-name"
            label={t("name")}
            type="text"
            name="name"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="Revolut, Trade Republic…"
            required
          />
        )}

        {woobEnabled && (
          <>
            <input type="hidden" name="woobModule" value={selectedModule} />
            <div className="space-y-3 pt-1 border-t border-[var(--border)]">
              <p className="text-xs text-[var(--muted)] pt-1">{t("woobHint")}</p>
              <Input id="inst-woob-login" label={t("login")} type="text" name="woobLogin" autoComplete="username" required />
              <Input id="inst-woob-password" label={t("password")} type="password" name="woobPassword" autoComplete="current-password" required />
            </div>
          </>
        )}

        {selectedModule && (
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => { reset(); setOpen(false); }}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t("creating") : t("submit")}
            </Button>
          </div>
        )}
      </form>
    </Dialog>
  );
}
