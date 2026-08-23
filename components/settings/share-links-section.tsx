"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Copy, Check, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { EmptyState } from "@/components/shared/empty-state";
import { createShareLink, revokeShareLink } from "@/lib/actions/share-links";
import { isShareLinkExpired } from "@/lib/domain/share-links";

type ShareLinkRow = {
  id: string;
  token: string;
  label: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  lastAccessedAt: Date | null;
  includeHoldings: boolean;
  includeTransactions: boolean;
};

function CopyButton({ token }: Readonly<{ token: string }>) {
  const t = useTranslations("settings.shareLinks");
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const url = `${window.location.origin}/shared/${token}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Button variant="outline" size="sm" onClick={handleCopy}>
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      {copied ? t("copied") : t("copy")}
    </Button>
  );
}

export function ShareLinksSection({ links }: Readonly<{ links: ShareLinkRow[] }>) {
  const t = useTranslations("settings.shareLinks");
  const tc = useTranslations("common");
  const router = useRouter();

  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<string>("never");
  const [includeHoldings, setIncludeHoldings] = useState(false);
  const [includeTransactions, setIncludeTransactions] = useState(false);
  const [creating, setCreating] = useState(false);

  function resetForm() {
    setLabel("");
    setExpiresInDays("never");
    setIncludeHoldings(false);
    setIncludeTransactions(false);
  }

  async function handleCreate() {
    setCreating(true);
    try {
      await createShareLink(
        label.trim() || null,
        expiresInDays === "never" ? null : Number(expiresInDays),
        includeHoldings,
        includeTransactions,
      );
      setCreateOpen(false);
      resetForm();
      router.refresh();
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    await revokeShareLink(id);
    router.refresh();
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--foreground)] truncate">{t("title")}</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">{t("subtitle")}</p>
        </div>
        <Dialog
          open={createOpen}
          onOpenChange={(v) => {
            setCreateOpen(v);
            if (!v) resetForm();
          }}
          title={t("createTitle")}
          trigger={
            <Button variant="outline" size="sm">
              <Plus size={14} aria-hidden="true" />
              {t("create")}
            </Button>
          }
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="share-label" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                {t("labelField")}
              </label>
              <input
                id="share-label"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t("labelPlaceholder")}
                className="w-full px-3 py-2 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="share-expiry" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                {t("expiryField")}
              </label>
              <select
                id="share-expiry"
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:border-[var(--accent)]"
              >
                <option value="never">{t("expiryNever")}</option>
                <option value="7">{t("expiryDays", { count: 7 })}</option>
                <option value="30">{t("expiryDays", { count: 30 })}</option>
                <option value="90">{t("expiryDays", { count: 90 })}</option>
              </select>
            </div>
            <div className="pt-1 space-y-2.5">
              <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("includeField")}</p>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeHoldings}
                  onChange={(e) => setIncludeHoldings(e.target.checked)}
                  className="w-4 h-4 rounded accent-[var(--accent)]"
                />
                <span className="text-sm text-[var(--foreground)]">{t("includeHoldings")}</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeTransactions}
                  onChange={(e) => setIncludeTransactions(e.target.checked)}
                  className="w-4 h-4 rounded accent-[var(--accent)]"
                />
                <span className="text-sm text-[var(--foreground)]">{t("includeTransactions")}</span>
              </label>
              <p className="text-xs text-[var(--muted)]">{t("includeHint")}</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
                {tc("cancel")}
              </Button>
              <Button onClick={handleCreate} disabled={creating}>
                {creating ? t("creating") : t("confirm")}
              </Button>
            </div>
          </div>
        </Dialog>
      </div>

      {links.length === 0 ? (
        <EmptyState icon={Link2} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
          {links.map((link) => {
            const expired = isShareLinkExpired(link.expiresAt);
            return (
              <div key={link.id} className="px-5 py-3.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      {link.label || t("unlabeled")}
                    </p>
                    <span
                      className={`text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        expired
                          ? "bg-[var(--negative)]/15 text-[var(--negative)]"
                          : "bg-[var(--positive)]/15 text-[var(--positive)]"
                      }`}
                    >
                      {expired ? t("statusExpired") : t("statusActive")}
                    </span>
                    {link.includeHoldings && (
                      <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent-text)]">
                        {t("includeHoldings")}
                      </span>
                    )}
                    {link.includeTransactions && (
                      <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent-text)]">
                        {t("includeTransactions")}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--muted)] mt-0.5">
                    {t("createdOn", { date: link.createdAt.toLocaleDateString() })}
                    {link.expiresAt && ` · ${t("expiresOn", { date: link.expiresAt.toLocaleDateString() })}`}
                    {" · "}
                    {link.lastAccessedAt
                      ? t("lastViewedOn", { date: link.lastAccessedAt.toLocaleDateString() })
                      : t("neverViewed")}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <CopyButton token={link.token} />
                  <DeleteButton
                    label={t("revoke")}
                    description={t("revokeDescription")}
                    onDelete={handleRevoke.bind(null, link.id)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
