"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Copy, Check, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/shared/delete-button";
import { createInvitation, revokeInvitation, deleteUser } from "@/lib/actions/users";

type UserRow = {
  id: string;
  username: string | null;
  displayName: string | null;
  role: "ADMIN" | "MEMBER";
  createdAt: Date;
};

type InvitationRow = {
  id: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
};

/**
 * Admin-only user management (v2.0). The admin never sets anyone's password -
 * they generate a single-use link and the invitee chooses their own on the
 * same screen the owner's own bootstrap uses. See lib/actions/users.ts.
 *
 * Only rendered when AUTH_ENABLED is on: with no login there are no other
 * users to manage, and showing an empty user list on a mono instance would
 * suggest a feature that isn't there.
 */
function CopyInviteButton({ token }: Readonly<{ token: string }>) {
  const t = useTranslations("settings.users");
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(`${window.location.origin}/invite/${token}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Button variant="outline" size="sm" onClick={handleCopy}>
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      {copied ? t("copied") : t("copyLink")}
    </Button>
  );
}

export function UsersSection({
  users,
  invitations,
  currentUserId,
  ownerUserId,
}: Readonly<{
  users: UserRow[];
  invitations: InvitationRow[];
  currentUserId: string;
  ownerUserId: string;
}>) {
  const t = useTranslations("settings.users");
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleInvite() {
    setCreating(true);
    setError(null);
    try {
      await createInvitation();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-x-3 gap-y-2">
        <div>
          <h2 className="text-lg font-medium text-[var(--foreground)]">{t("title")}</h2>
          <p className="text-sm text-[var(--muted)] mt-1">{t("description")}</p>
        </div>
        <Button onClick={handleInvite} disabled={creating} className="shrink-0">
          <UserPlus size={14} aria-hidden="true" />
          {creating ? t("generating") : t("invite")}
        </Button>
      </div>

      {error && <p className="text-sm text-[var(--negative)]">{error}</p>}

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
        {users.map((u) => (
          <div key={u.id} className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--foreground)] break-words">
                {u.displayName ?? u.username ?? t("noUsername")}
                {u.id === currentUserId && (
                  <span className="ml-2 text-xs text-[var(--muted)]">{t("you")}</span>
                )}
              </p>
              <p className="text-xs text-[var(--muted)]">
                {u.username ? `@${u.username} · ` : ""}
                {u.role === "ADMIN" ? t("roleAdmin") : t("roleMember")}
              </p>
            </div>
            {/* The owner row can never be deleted (every row the Python sync
                sidecar writes defaults to it, so removing it would break sync
                at the FK level) and you can't delete yourself - deleteUser
                enforces both server-side; this just doesn't offer it. */}
            {u.id !== ownerUserId && u.id !== currentUserId && (
              <DeleteButton
                onDelete={async () => {
                  await deleteUser(u.id);
                  router.refresh();
                }}
                label={t("deleteUser")}
                description={t("deleteConfirm", { name: u.username ?? u.id })}
              />
            )}
          </div>
        ))}
      </div>

      {invitations.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-[var(--foreground)]">{t("pendingInvitations")}</h3>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
            {invitations.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm text-[var(--foreground)]">{t("singleUseLink")}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {t("expiresOn", { date: inv.expiresAt.toLocaleString() })}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <CopyInviteButton token={inv.token} />
                  <DeleteButton
                    onDelete={async () => {
                      await revokeInvitation(inv.id);
                      router.refresh();
                    }}
                    label={t("revoke")}
                    description={t("revokeConfirm")}
                    iconOnly
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {users.length <= 1 && invitations.length === 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-8 text-center">
          <Users size={20} aria-hidden="true" className="mx-auto text-[var(--muted)]" />
          <p className="text-sm text-[var(--muted)] mt-2">{t("empty")}</p>
        </div>
      )}
    </section>
  );
}
