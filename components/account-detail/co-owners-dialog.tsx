"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
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
 *
 * **Why a header dialog rather than a section.** It shipped as a card at the
 * BOTTOM of the account page, below the transactions table - which renders up
 * to 200 rows. On any account with real history you had to scroll past all of
 * them to reach it, and if you did not already know the feature existed you
 * never would: nothing above the fold hinted at it. Reported as exactly that.
 *
 * Moving it into the header fixes both halves at once. The trigger sits beside
 * the rename control, where account-level actions already live, and it carries
 * the co-owner COUNT rather than a bare icon - so the header answers "is this
 * account shared, and with how many people" without opening anything. That
 * makes it state you can read, not just an action you can take, which is the
 * part a buried section could never do.
 */
const SHARE_ERRORS = {
  username_required: "errorUsernameRequired",
  no_such_user: "errorNoSuchUser",
  that_is_you: "errorThatIsYou",
} as const;

export function CoOwnersDialog({
  accountId,
  coOwners,
}: Readonly<{ accountId: string; coOwners: CoOwnerRow[] }>) {
  const t = useTranslations("accountDetail.coOwners");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
  const shared = coOwners.length > 0;

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
        <button
          type="button"
          aria-label={shared ? t("triggerShared", { count: coOwners.length }) : t("trigger")}
          title={shared ? t("triggerShared", { count: coOwners.length }) : t("trigger")}
          className={`inline-flex items-center justify-center gap-1 min-h-[44px] px-2 rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
            shared
              ? "text-[var(--accent-text)] hover:bg-[var(--surface-elevated)]"
              : "min-w-[44px] text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-elevated)]"
          }`}
        >
          <Users size={14} aria-hidden="true" />
          {/* The count is the point: an account shared with someone says so in
              the header, instead of looking identical to a private one. */}
          {shared && <span className="text-xs font-medium tabular-nums">{coOwners.length}</span>}
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-[var(--muted)]">{t("description")}</p>

        {shared && (
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

        {error && (
          <p role="alert" className="text-sm text-[var(--negative)]">
            {error}
          </p>
        )}

        <div className="flex justify-end pt-1">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {tc("close")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
