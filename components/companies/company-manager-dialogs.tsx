"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Pencil, Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DeleteButton } from "@/components/shared/delete-button";
import {
  deleteCompany,
  saveCapTable,
  setAccountCompany,
  setInstitutionCompany,
  transferCompanyManagement,
  updateCompany,
  type CompanyFailure,
} from "@/lib/actions/companies";
import { CapTableEditor, newRowKey, toCapTableInput, type CapTableRowDraft } from "@/components/companies/cap-table-editor";

/**
 * The company page's manager tools. Rendered for the manager only, and every
 * action behind them refuses anyone else (assertCompanyManager) - the hiding
 * is so an associate is never offered a button whose only outcome is an error.
 */

export type ManagerAssociate = {
  id: string;
  name: string;
  parts: number;
  username: string | null;
  isViewer: boolean;
  link: "accepted" | "pending" | null;
};

function useFailureText() {
  const t = useTranslations("companies.errors");
  return (result: { ok: true } | CompanyFailure) => (result.ok ? null : t(result.error));
}

// ── Associates ────────────────────────────────────────────────────────────

export function CapTableDialog({
  companyId,
  totalParts: initialTotal,
  associates,
}: Readonly<{ companyId: string; totalParts: number; associates: ManagerAssociate[] }>) {
  const t = useTranslations("companies");
  const router = useRouter();
  const failureText = useFailureText();
  const initialRows = (): CapTableRowDraft[] =>
    associates.map((a) => ({
      key: newRowKey(),
      id: a.id,
      name: a.name,
      parts: String(a.parts),
      username: a.username ?? "",
      self: a.isViewer,
    }));
  const [open, setOpen] = useState(false);
  const [totalParts, setTotalParts] = useState(String(initialTotal));
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const result = await saveCapTable(companyId, { totalParts: Number(totalParts), associates: toCapTableInput(rows) });
      const failure = failureText(result);
      if (failure) {
        setError(failure);
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setRows(initialRows());
          setTotalParts(String(initialTotal));
          setError(null);
        }
      }}
      title={t("capTable.title")}
      trigger={
        <Button variant="ghost" size="sm">
          <Pencil size={14} aria-hidden="true" />
          {t("page.editAssociates")}
        </Button>
      }
    >
      <div className="space-y-4">
        <Input
          label={t("wizard.totalParts")}
          inputMode="numeric"
          value={totalParts}
          onChange={(e) => setTotalParts(e.target.value.replace(/\D/g, ""))}
        />
        <CapTableEditor totalParts={Number(totalParts)} rows={rows} onRowsChange={setRows} />
        {error && <p role="alert" className="text-sm text-[var(--negative-text)]">{error}</p>}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t("capTable.saving") : t("capTable.save")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ── Accounts ──────────────────────────────────────────────────────────────

type Attachable = {
  personalAccounts: { id: string; name: string }[];
  personalInstitutions: { id: string; name: string; accountCount: number }[];
  companyAccounts: { id: string; name: string }[];
  companyInstitutions: { id: string; name: string; accountCount: number }[];
};

function AttachRow({
  name,
  detail,
  actionLabel,
  onAction,
  disabled,
}: Readonly<{ name: string; detail?: string; actionLabel: string; onAction: () => void; disabled: boolean }>) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0 break-words text-sm text-[var(--foreground)]">
        {name}
        {detail && <span className="ml-2 text-xs text-[var(--muted)]">{detail}</span>}
      </span>
      <Button variant="outline" size="sm" onClick={onAction} disabled={disabled}>
        {actionLabel}
      </Button>
    </li>
  );
}

export function AttachAccountsDialog({ companyId, attachable }: Readonly<{ companyId: string; attachable: Attachable }>) {
  const t = useTranslations("companies.attachDialog");
  const tp = useTranslations("companies.page");
  const router = useRouter();
  const failureText = useFailureText();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ ok: true } | CompanyFailure>) {
    setBusy(true);
    setError(null);
    try {
      setError(failureText(await action()));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const inCompany = attachable.companyInstitutions.length + attachable.companyAccounts.length;
  const available = attachable.personalInstitutions.length + attachable.personalAccounts.length;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
      title={t("title")}
      description={t("description")}
      trigger={
        <Button variant="outline" size="sm">
          <Link2 size={14} aria-hidden="true" />
          {tp("attach")}
        </Button>
      }
    >
      <div className="space-y-5">
        <p className="text-xs text-[var(--muted)]">{t("description")}</p>
        {inCompany > 0 && (
          <section>
            <h3 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("inCompany")}</h3>
            <ul className="divide-y divide-[var(--border)]">
              {attachable.companyInstitutions.map((i) => (
                <AttachRow key={i.id} name={i.name} detail={t("accountCount", { count: i.accountCount })} actionLabel={t("detach")} disabled={busy} onAction={() => run(() => setInstitutionCompany(i.id, null))} />
              ))}
              {attachable.companyAccounts.map((a) => (
                <AttachRow key={a.id} name={a.name} actionLabel={t("detach")} disabled={busy} onAction={() => run(() => setAccountCompany(a.id, null))} />
              ))}
            </ul>
          </section>
        )}
        {attachable.personalInstitutions.length > 0 && (
          <section>
            <h3 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("yourInstitutions")}</h3>
            <ul className="divide-y divide-[var(--border)]">
              {attachable.personalInstitutions.map((i) => (
                <AttachRow key={i.id} name={i.name} detail={t("accountCount", { count: i.accountCount })} actionLabel={t("attach")} disabled={busy} onAction={() => run(() => setInstitutionCompany(i.id, companyId))} />
              ))}
            </ul>
          </section>
        )}
        {attachable.personalAccounts.length > 0 && (
          <section>
            <h3 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("yourAccounts")}</h3>
            <ul className="divide-y divide-[var(--border)]">
              {attachable.personalAccounts.map((a) => (
                <AttachRow key={a.id} name={a.name} actionLabel={t("attach")} disabled={busy} onAction={() => run(() => setAccountCompany(a.id, companyId))} />
              ))}
            </ul>
          </section>
        )}
        {available === 0 && inCompany === 0 && <p className="text-sm text-[var(--muted)]">{t("empty")}</p>}
        {error && <p role="alert" className="text-sm text-[var(--negative-text)]">{error}</p>}
      </div>
    </Dialog>
  );
}

// ── Settings, hand-over, deletion ─────────────────────────────────────────

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
