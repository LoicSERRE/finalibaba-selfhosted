"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DeleteButton } from "@/components/shared/delete-button";
import { addAccountCoOwner, removeAccountCoOwner } from "@/lib/actions/sharing";

type CoOwnerRow = {
  userId: string;
  username: string | null;
  displayName: string | null;
};

/**
 * Per-account co-ownership (v2.0) - a joint account appearing in two people's
 * portfolios, pointing at the same rows. Unlike a portfolio grant (Settings →
 * portfolio sharing), this grants WRITE access: either co-owner can categorize
 * a transaction, record a sale, import a CSV.
 *
 * Only rendered for the account's direct owner. A co-owner cannot add further
 * co-owners, so the permission graph stays one level deep - see
 * assertAccountOwner in lib/actions/sharing.ts.
 */
const SHARE_ERRORS = {
  username_required: "errorUsernameRequired",
  no_such_user: "errorNoSuchUser",
  that_is_you: "errorThatIsYou",
} as const;

export function CoOwnersSection({
  accountId,
  coOwners,
}: Readonly<{ accountId: string; coOwners: CoOwnerRow[] }>) {
  const t = useTranslations("accountDetail.coOwners");
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(formData: FormData) {
    setSaving(true);
    setError(null);
    try {
      // A returned failure, not a thrown one: production replaces a thrown
      // Server Action error with an opaque digest, so "no such user" reached
      // the screen as an unreadable internal error.
      const result = await addAccountCoOwner(accountId, formData);
      if (!result.ok) {
        setError(t(SHARE_ERRORS[result.error]));
        return;
      }
      setUsername("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const label = (c: CoOwnerRow) => c.displayName ?? c.username ?? c.userId;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Users size={16} aria-hidden="true" className="text-[var(--muted)]" />
        <h2 className="text-sm font-medium text-[var(--foreground)]">{t("title")}</h2>
      </div>
      <p className="text-xs text-[var(--muted)]">{t("description")}</p>

      {coOwners.length > 0 && (
        <div className="border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
          {coOwners.map((c) => (
            <div key={c.userId} className="flex items-center justify-between gap-3 px-3 py-2.5 flex-wrap">
              <p className="text-sm text-[var(--foreground)] break-words">{label(c)}</p>
              <DeleteButton
                onDelete={async () => {
                  await removeAccountCoOwner(accountId, c.userId);
                  router.refresh();
                }}
                label={t("remove")}
                description={t("removeConfirm", { name: label(c) })}
                iconOnly
              />
            </div>
          ))}
        </div>
      )}

      <form action={handleAdd} className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[180px]">
          <label htmlFor="co-owner-username" className="block text-xs text-[var(--muted)] mb-1">
            {t("usernameLabel")}
          </label>
          <Input
            id="co-owner-username"
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t("usernamePlaceholder")}
            autoComplete="off"
          />
        </div>
        <Button type="submit" disabled={saving || username.trim() === ""}>
          <UserPlus size={14} aria-hidden="true" />
          {saving ? t("adding") : t("add")}
        </Button>
      </form>

      {error && <p className="text-sm text-[var(--negative)]">{error}</p>}
    </div>
  );
}
