"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Link2 } from "lucide-react";
import { setAccountCompany, setInstitutionCompany, type CompanyFailure } from "@/lib/actions/companies";
import { AttachRow } from "@/components/companies/attach-row";
import { useFailureText } from "@/components/companies/manager-shared";

type Attachable = {
  personalAccounts: { id: string; name: string }[];
  personalInstitutions: { id: string; name: string; accountCount: number }[];
  companyAccounts: { id: string; name: string }[];
  companyInstitutions: { id: string; name: string; accountCount: number }[];
};

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
