"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createCompany, setAccountCompany, setInstitutionCompany, type CompanyFailure } from "@/lib/actions/companies";
import { capTableDraft } from "@/lib/domain/company";
import { CapTableEditor, newRowKey, toCapTableInput, type CapTableRowDraft } from "@/components/companies/cap-table-editor";

export type AttachableItems = {
  accounts: { id: string; name: string }[];
  institutions: { id: string; name: string; accountCount: number }[];
};

const KINDS = ["SCI", "HOLDING", "OTHER"] as const;
const REGIMES = ["IR", "IS"] as const;

const selectClass =
  "w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 min-h-11 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] cursor-pointer";

/**
 * The guided creation (dev-docs/companies.md, interface "C"): the company,
 * then its associates and parts, then what it owns. Set up once, so one
 * question per screen beats a long form. The server re-checks everything.
 */
export function CreateCompanyDialog({ attachable }: Readonly<{ attachable: AttachableItems }>) {
  const t = useTranslations("companies");
  const tw = useTranslations("companies.wizard");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("SCI");
  const [taxRegime, setTaxRegime] = useState<(typeof REGIMES)[number]>("IR");
  const [totalParts, setTotalParts] = useState("1000");
  const [rows, setRows] = useState<CapTableRowDraft[]>(() => [
    { key: newRowKey(), name: "", parts: "", username: "", self: true },
  ]);
  const [accountIds, setAccountIds] = useState<Set<string>>(new Set());
  const [institutionIds, setInstitutionIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const total = Number(totalParts);
  const canContinue =
    step === 1 ? name.trim() !== "" && Number.isInteger(total) && total > 0 : capTableDraft(total, rows.map((r) => Number(r.parts))).complete;

  function reset() {
    setStep(1);
    setError(null);
  }

  function toggle(set: Set<string>, id: string, apply: (next: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  }

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const result = await createCompany({ name, kind, taxRegime, totalParts: total, associates: toCapTableInput(rows) });
      if (!result.ok) {
        setError(t(`errors.${result.error}`));
        // Back to the step the failure is about.
        setStep(["name_required", "name_too_long", "total_parts_invalid", "kind_invalid", "regime_invalid"].includes(result.error) ? 1 : 2);
        return;
      }
      const moves: Promise<{ ok: true } | CompanyFailure>[] = [
        ...[...institutionIds].map((id) => setInstitutionCompany(id, result.companyId)),
        ...[...accountIds].map((id) => setAccountCompany(id, result.companyId)),
      ];
      await Promise.all(moves);
      setOpen(false);
      router.push(`/companies/${result.companyId}`);
    } finally {
      setSaving(false);
    }
  }

  const hasAttachable = attachable.accounts.length + attachable.institutions.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
      title={tw("title")}
      description={tw("stepOf", { step })}
      trigger={
        <Button variant="outline">
          <Building2 size={14} aria-hidden="true" />
          {t("newCompany")}
        </Button>
      }
    >
      <div className="space-y-5">
        <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label={tw("stepOf", { step })}>
          {[tw("step1"), tw("step2"), tw("step3")].map((label, i) => (
            <li
              key={label}
              aria-current={step === i + 1 ? "step" : undefined}
              className={step === i + 1 ? "font-semibold text-[var(--accent-text)]" : step > i + 1 ? "text-[var(--positive-text)]" : "text-[var(--muted)]"}
            >
              {i + 1} · {label}
            </li>
          ))}
        </ol>

        {step === 1 && (
          <div className="space-y-4">
            <Input label={tw("name")} value={name} onChange={(e) => setName(e.target.value)} placeholder={tw("namePlaceholder")} autoFocus />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="company-kind" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                  {tw("kindLabel")}
                </label>
                <select id="company-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={selectClass}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>{t(`kind.${k}`)}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="company-regime" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                  {tw("regimeLabel")}
                </label>
                <select id="company-regime" value={taxRegime} onChange={(e) => setTaxRegime(e.target.value as typeof taxRegime)} className={selectClass}>
                  {REGIMES.map((r) => (
                    <option key={r} value={r}>{t(`regime.${r}`)}</option>
                  ))}
                </select>
              </div>
            </div>
            <Input
              label={tw("totalParts")}
              inputMode="numeric"
              value={totalParts}
              onChange={(e) => setTotalParts(e.target.value.replace(/\D/g, ""))}
            />
          </div>
        )}

        {step === 2 && <CapTableEditor totalParts={total} rows={rows} onRowsChange={setRows} />}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-xs text-[var(--muted)]">{tw("step3Hint")}</p>
            {!hasAttachable && <p className="text-sm text-[var(--muted)]">{tw("nothingToAttach")}</p>}
            {attachable.institutions.length > 0 && (
              <fieldset className="space-y-1">
                <legend className="text-xs font-medium text-[var(--muted)] mb-1">{t("attachDialog.yourInstitutions")}</legend>
                {attachable.institutions.map((i) => (
                  <label key={i.id} className="flex items-center gap-3 min-h-11 px-2 rounded-lg hover:bg-[var(--surface-elevated)] cursor-pointer text-sm">
                    <input type="checkbox" checked={institutionIds.has(i.id)} onChange={() => toggle(institutionIds, i.id, setInstitutionIds)} className="size-4" />
                    <span className="flex-1 min-w-0 break-words">{i.name}</span>
                    <span className="text-xs text-[var(--muted)]">{t("attachDialog.accountCount", { count: i.accountCount })}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {attachable.accounts.length > 0 && (
              <fieldset className="space-y-1">
                <legend className="text-xs font-medium text-[var(--muted)] mb-1">{t("attachDialog.yourAccounts")}</legend>
                {attachable.accounts.map((a) => (
                  <label key={a.id} className="flex items-center gap-3 min-h-11 px-2 rounded-lg hover:bg-[var(--surface-elevated)] cursor-pointer text-sm">
                    <input type="checkbox" checked={accountIds.has(a.id)} onChange={() => toggle(accountIds, a.id, setAccountIds)} className="size-4" />
                    <span className="flex-1 min-w-0 break-words">{a.name}</span>
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        )}

        {error && <p role="alert" className="text-sm text-[var(--negative-text)]">{error}</p>}

        <div className="flex justify-between gap-2 pt-1">
          <Button variant="outline" onClick={() => (step === 1 ? setOpen(false) : setStep(step - 1))} disabled={saving}>
            {step === 1 ? tc("cancel") : tw("back")}
          </Button>
          {step < 3 ? (
            <Button onClick={() => { setError(null); setStep(step + 1); }} disabled={!canContinue}>
              {tw("next")}
            </Button>
          ) : (
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? tw("creating") : tw("create")}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
