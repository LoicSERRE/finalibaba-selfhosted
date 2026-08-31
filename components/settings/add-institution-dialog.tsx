"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, AlertTriangle } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WoobModulePicker } from "@/components/settings/woob-module-picker";
import { createInstitution } from "@/lib/actions/institutions";
import { bankPickerEntries, isTradeRepublicModule } from "@/lib/domain/sync-providers";
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
  // Lowercased names of dedicated .env-configured integrations (LCL_LOGIN/
  // TR_PHONE) currently active - see app/settings/page.tsx's
  // dedicatedEnvNames(). Warns rather than blocks if the picked bank
  // matches one of these, since creating a second institution of the same
  // name would fail on Institution.name's unique constraint if the usual
  // seeded reference row already exists anyway - this only guards the case
  // where it doesn't (e.g. a fresh, unseeded install).
  dedicatedEnvNames: Set<string>;
}

export function AddInstitutionDialog({ modules, dedicatedEnvNames }: Readonly<Props>) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [selectedModule, setSelectedModule] = useState("");
  const [customName, setCustomName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("addInstitution");
  const tc = useTranslations("common");

  // Trade Republic sits in the same searchable list as every Woob bank -
  // which backend reaches it is this app's problem, not the user's.
  const banks = useMemo(() => bankPickerEntries(modules), [modules]);
  const knownBank = banks.find((m) => m.module === selectedModule);
  const isCustom = selectedModule === "__other__";
  const isTradeRepublic = isTradeRepublicModule(selectedModule);
  const woobEnabled = !!knownBank && !isTradeRepublic;
  const hasDedicatedEnvSync = !!knownBank && dedicatedEnvNames.has(knownBank.label.toLowerCase());

  const reset = () => {
    setSelectedModule("");
    setCustomName("");
    setError(null);
  };

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // Ensure name is set (auto from known bank or custom input)
    if (!fd.get("name")) return;
    setError(null);
    startTransition(async () => {
      try {
        await createInstitution(fd);
        reset();
        setOpen(false);
      } catch (e) {
        // Previously unhandled, so a rejected create - a name already in use
        // being the realistic one - left the dialog sitting there as if
        // nothing had been clicked.
        setError(e instanceof Error ? e.message : t("unknownError"));
      }
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
          modules={banks}
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
            placeholder="Revolut, Degiro…"
            required
          />
        )}

        {isTradeRepublic && (
          <div className="space-y-3 pt-1 border-t border-[var(--border)]">
            {hasDedicatedEnvSync && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--warning)]/10 border border-[var(--warning)]/40">
                <AlertTriangle size={14} className="text-[var(--warning)] shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-xs text-[var(--warning)]">{t("dedicatedEnvWarning")}</p>
              </div>
            )}
            <p className="text-xs text-[var(--muted)] pt-1">{t("trHint")}</p>
            <Input id="inst-tr-phone" label={t("trPhone")} type="text" name="trPhone" placeholder="+33612345678" autoComplete="off" required />
            <Input id="inst-tr-pin" label={t("trPin")} type="password" name="trPin" placeholder="••••" autoComplete="off" required />
          </div>
        )}

        {woobEnabled && (
          <>
            <input type="hidden" name="woobModule" value={selectedModule} />
            <div className="space-y-3 pt-1 border-t border-[var(--border)]">
              {hasDedicatedEnvSync && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--warning)]/10 border border-[var(--warning)]/40">
                  <AlertTriangle size={14} className="text-[var(--warning)] shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="text-xs text-[var(--warning)]">{t("dedicatedEnvWarning")}</p>
                </div>
              )}
              <p className="text-xs text-[var(--muted)] pt-1">{t("woobHint")}</p>
              <Input id="inst-woob-login" label={t("login")} type="text" name="woobLogin" autoComplete="username" required />
              <Input id="inst-woob-password" label={t("password")} type="password" name="woobPassword" autoComplete="current-password" required />
            </div>
          </>
        )}

        {error && <p role="alert" className="text-xs text-[var(--negative)]">{error}</p>}

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
