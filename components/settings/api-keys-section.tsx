"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Copy, Check, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { EmptyState } from "@/components/shared/empty-state";
import { createApiKey, revokeApiKey } from "@/lib/actions/api-keys";

type ApiKeyRow = {
  id: string;
  token: string;
  label: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
};

// Never renders `key.token` as visible text anywhere in the row - same
// convention as CopyButton in share-links-section.tsx, which only ever
// reads the token internally to build the copied value.
function CopyButton({ token }: Readonly<{ token: string }>) {
  const t = useTranslations("settings.apiKeys");
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(token);
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

export function ApiKeysSection({ keys }: Readonly<{ keys: ApiKeyRow[] }>) {
  const t = useTranslations("settings.apiKeys");
  const tc = useTranslations("common");
  const router = useRouter();

  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setCreating(true);
    try {
      await createApiKey(label.trim() || null);
      setCreateOpen(false);
      setLabel("");
      router.refresh();
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    await revokeApiKey(id);
    router.refresh();
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">{t("title")}</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">{t("subtitle")}</p>
        </div>
        <Dialog
          open={createOpen}
          onOpenChange={(v) => {
            setCreateOpen(v);
            if (!v) setLabel("");
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
              <label htmlFor="api-key-label" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                {t("labelField")}
              </label>
              <input
                id="api-key-label"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t("labelPlaceholder")}
                className="w-full px-3 py-2 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:border-[var(--accent)]"
              />
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

      {keys.length === 0 ? (
        <EmptyState icon={KeyRound} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
          {keys.map((key) => (
            <div key={key.id} className="px-5 py-3.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">{key.label || t("unlabeled")}</p>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  {t("createdOn", { date: key.createdAt.toLocaleDateString() })}
                  {" · "}
                  {key.lastUsedAt ? t("lastUsedOn", { date: key.lastUsedAt.toLocaleDateString() }) : t("neverUsed")}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <CopyButton token={key.token} />
                <DeleteButton
                  label={t("revoke")}
                  description={t("revokeDescription")}
                  onDelete={handleRevoke.bind(null, key.id)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
