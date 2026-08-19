"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WoobModulePicker } from "@/components/settings/woob-module-picker";
import { createInstitution } from "@/lib/actions/institutions";
import { useTranslations } from "next-intl";

interface Props {
  // Every Woob module capable of bank sync (~96, fetched live from Woob's
  // repository by getWoobBankModules() and passed down from
  // app/settings/page.tsx) - same prop shape/fallback as
  // ConfigureWoobDialog's own `modules` prop. This dialog used to carry its
  // own separate hardcoded 17-bank list that never got wired to the live
  // catalog when that one was added - a real gap, since this "Ajouter une
  // institution" dialog is the first bank-picker a new user actually sees.
  modules: { module: string; label: string }[];
}

export function AddInstitutionDialog({ modules }: Readonly<Props>) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [selectedModule, setSelectedModule] = useState("");
  const [customName, setCustomName] = useState("");
  const t = useTranslations("addInstitution");
  const tc = useTranslations("common");

  const knownBank = modules.find((m) => m.module === selectedModule);
  const isCustom = selectedModule === "__other__";
  const woobEnabled = !!knownBank;

  const reset = () => {
    setSelectedModule("");
    setCustomName("");
  };

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
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
        <WoobModulePicker
          id="inst-bank"
          label={t("bank")}
          value={selectedModule}
          onChange={(v) => { setSelectedModule(v); setCustomName(""); }}
          modules={modules}
          otherValue="__other__"
          otherLabel={t("other")}
          placeholder={t("select")}
          searchPlaceholder={t("searchPlaceholder")}
          searchAriaLabel={t("searchAriaLabel")}
          noResultsLabel={t("noResults")}
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
