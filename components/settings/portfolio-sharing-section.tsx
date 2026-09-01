"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DeleteButton } from "@/components/shared/delete-button";
import { grantPortfolioAccess, revokePortfolioGrant } from "@/lib/actions/sharing";

type GrantRow = {
  userId: string;
  username: string | null;
  displayName: string | null;
  createdAt: Date;
};

/**
 * Read-only portfolio guests (v2.0) - "my partner can see my accounts but
 * touch nothing". Distinct from account co-ownership, which is per-account and
 * grants write access; see lib/actions/sharing.ts's header for why they're two
 * mechanisms rather than two settings of one.
 *
 * Also distinct from a share link (the section above): a share link is an
 * anonymous URL anyone holding it can open, a grant is tied to a real account
 * on this instance and shows up in that person's own portfolio switcher.
 */
const SHARE_ERRORS = {
  username_required: "errorUsernameRequired",
  no_such_user: "errorNoSuchUser",
  that_is_you: "errorThatIsYou",
} as const;

export function PortfolioSharingSection({
  given,
  received,
}: Readonly<{ given: GrantRow[]; received: GrantRow[] }>) {
  const t = useTranslations("settings.portfolioSharing");
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGrant(formData: FormData) {
    setSaving(true);
    setError(null);
    try {
      // A returned failure, not a thrown one: production replaces a thrown
      // Server Action error with an opaque digest, so "no such user" reached
      // the screen as an unreadable internal error.
      const result = await grantPortfolioAccess(formData);
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

  const label = (g: GrantRow) => g.displayName ?? g.username ?? g.userId;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-medium text-[var(--foreground)]">{t("title")}</h2>
        <p className="text-sm text-[var(--muted)] mt-1">{t("description")}</p>
      </div>

      <form action={handleGrant} className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="grant-username" className="block text-xs text-[var(--muted)] mb-1">
            {t("usernameLabel")}
          </label>
          <Input
            id="grant-username"
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t("usernamePlaceholder")}
            autoComplete="off"
          />
        </div>
        <Button type="submit" disabled={saving || username.trim() === ""}>
          <UserPlus size={14} aria-hidden="true" />
          {saving ? t("granting") : t("grant")}
        </Button>
      </form>

      {error && <p className="text-sm text-[var(--negative)]">{error}</p>}

      {given.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-[var(--foreground)]">{t("peopleWhoCanSee")}</h3>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
            {given.map((g) => (
              <div key={g.userId} className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm text-[var(--foreground)] break-words">{label(g)}</p>
                  <p className="text-xs text-[var(--muted)]">{t("readOnlyAccess")}</p>
                </div>
                <DeleteButton
                  onDelete={async () => {
                    await revokePortfolioGrant(g.userId);
                    router.refresh();
                  }}
                  label={t("revoke")}
                  description={t("revokeConfirm", { name: label(g) })}
                  iconOnly
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {received.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-[var(--foreground)]">{t("sharedWithYou")}</h3>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
            {received.map((g) => (
              <div key={g.userId} className="flex items-center gap-2 px-4 py-3">
                <Eye size={14} aria-hidden="true" className="text-[var(--muted)] shrink-0" />
                <p className="text-sm text-[var(--foreground)] break-words">{label(g)}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-[var(--muted)]">{t("switcherHint")}</p>
        </div>
      )}

      {given.length === 0 && received.length === 0 && (
        <p className="text-sm text-[var(--muted)]">{t("empty")}</p>
      )}
    </section>
  );
}
