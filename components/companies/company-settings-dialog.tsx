"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DeleteButton } from "@/components/shared/delete-button";
import { Settings } from "lucide-react";
import { deleteCompany, transferCompanyManagement, updateCompany, type CompanyFailure } from "@/lib/actions/companies";
import { useFailureText, type ManagerAssociate } from "@/components/companies/manager-shared";

const KINDS = ["SCI", "HOLDING", "OTHER"] as const;
const REGIMES = ["IR", "IS"] as const;
const selectClass =
  "w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 min-h-11 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] cursor-pointer";

export function CompanySettingsDialog({
  company,
  associates,
}: Readonly<{
  company: { id: string; name: string; kind: string; taxRegime: string };
  associates: ManagerAssociate[];
}>) {
  const t = useTranslations("companies");
  const ts = useTranslations("companies.settingsDialog");
  const router = useRouter();
  const failureText = useFailureText();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(company.name);
  const [kind, setKind] = useState(company.kind);
  const [taxRegime, setTaxRegime] = useState(company.taxRegime);
  const candidates = associates.filter((a) => a.link === "accepted" && !a.isViewer);
  const [nextManager, setNextManager] = useState(candidates[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<{ ok: true } | CompanyFailure>, after: () => void) {
    setBusy(true);
    setError(null);
    try {
      const failure = failureText(await action());
      if (failure) {
        setError(failure);
        return;
      }
      after();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
      title={ts("title")}
      trigger={
        <Button variant="outline" size="sm">
          <Settings size={14} aria-hidden="true" />
          {t("page.settings")}
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="space-y-3">
          <Input label={t("wizard.name")} value={name} onChange={(e) => setName(e.target.value)} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="settings-kind" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("wizard.kindLabel")}</label>
              <select id="settings-kind" value={kind} onChange={(e) => setKind(e.target.value)} className={selectClass}>
                {KINDS.map((k) => <option key={k} value={k}>{t(`kind.${k}`)}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="settings-regime" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("wizard.regimeLabel")}</label>
              <select id="settings-regime" value={taxRegime} onChange={(e) => setTaxRegime(e.target.value)} className={selectClass}>
                {REGIMES.map((r) => <option key={r} value={r}>{t(`regime.${r}`)}</option>)}
              </select>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              disabled={busy}
              onClick={() => run(() => updateCompany(company.id, { name, kind, taxRegime }), () => { setOpen(false); router.refresh(); })}
            >
              {ts("save")}
            </Button>
          </div>
        </div>

        <div className="space-y-2 border-t border-[var(--border)] pt-4">
          <h3 className="text-sm font-medium text-[var(--foreground)]">{ts("handover")}</h3>
          <p className="text-xs text-[var(--muted)]">{ts("handoverHint")}</p>
          {candidates.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{ts("noHandoverCandidate")}</p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5 flex-1 min-w-[180px]">
                <label htmlFor="settings-handover" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{ts("handoverTo")}</label>
                <select id="settings-handover" value={nextManager} onChange={(e) => setNextManager(e.target.value)} className={selectClass}>
                  {candidates.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <Button
                variant="outline"
                disabled={busy || !nextManager}
                onClick={() => run(() => transferCompanyManagement(company.id, nextManager), () => { setOpen(false); router.refresh(); })}
              >
                {ts("handoverButton")}
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
          <p className="text-sm text-[var(--foreground)]">{ts("delete")}</p>
          <DeleteButton
            label={ts("delete")}
            description={ts("deleteConfirm")}
            onDelete={async () => {
              await deleteCompany(company.id);
              router.push("/accounts");
            }}
          />
        </div>
        {error && <p role="alert" className="text-sm text-[var(--negative-text)]">{error}</p>}
      </div>
    </Dialog>
  );
}
