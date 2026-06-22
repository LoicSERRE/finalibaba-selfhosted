"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createInstitution } from "@/lib/actions/institutions";

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

const inputClass =
  "w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30";

export function AddInstitutionDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [selectedModule, setSelectedModule] = useState("");
  const [customName, setCustomName] = useState("");

  const knownBank = WOOB_MODULES.find((m) => m.module === selectedModule);
  const isCustom = selectedModule === "__other__";
  const woobEnabled = !!knownBank;

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
      title="Ajouter une institution"
      trigger={
        <Button>
          <Plus size={14} aria-hidden="true" />
          Nouvelle institution
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Bank selector */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
            Banque
          </label>
          <select
            value={selectedModule}
            onChange={(e) => { setSelectedModule(e.target.value); setCustomName(""); }}
            className={inputClass}
            required
          >
            <option value="">Sélectionner…</option>
            {WOOB_MODULES.map((m) => (
              <option key={m.module} value={m.module}>{m.label}</option>
            ))}
            <option value="__other__">Autre</option>
          </select>
        </div>

        {/* Hidden name field for known banks */}
        {knownBank && (
          <input type="hidden" name="name" value={knownBank.label} />
        )}

        {/* Custom name for "Autre" */}
        {isCustom && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
              Nom
            </label>
            <input
              type="text"
              name="name"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="Revolut, Trade Republic…"
              required
              className={inputClass}
            />
          </div>
        )}

        {/* Woob credentials — only for known modules */}
        {woobEnabled && (
          <>
            <input type="hidden" name="woobModule" value={selectedModule} />
            <div className="space-y-3 pt-1 border-t border-[var(--border)]">
              <p className="text-xs text-[var(--muted)] pt-1">
                Sync automatique via Woob — historique illimité stocké dans votre base.
              </p>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                  Identifiant / n° client
                </label>
                <input
                  type="text"
                  name="woobLogin"
                  autoComplete="username"
                  required
                  className={inputClass}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                  Mot de passe
                </label>
                <input
                  type="password"
                  name="woobPassword"
                  autoComplete="current-password"
                  required
                  className={inputClass}
                />
              </div>
            </div>
          </>
        )}

        {selectedModule && (
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => { reset(); setOpen(false); }}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Création…" : "Ajouter"}
            </Button>
          </div>
        )}
      </form>
    </Dialog>
  );
}
