"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changeOwnPassword } from "@/lib/actions/users";

/**
 * Your own account: who you are, and how to change your password.
 *
 * Also the only path out of the "still on the env password" state. Turning
 * AUTH_ENABLED on while AUTH_PASSWORD is already set deliberately does NOT
 * force the bootstrap screen (login keeps working, see needsBootstrap), but
 * that leaves the owner with no username and no in-app password - so this
 * section prompts for both, once, and then behaves like a normal password
 * form. Without it that state had no exit at all.
 */
export function AccountSection({
  username,
  displayName,
  role,
  needsSetup,
}: Readonly<{
  username: string | null;
  displayName: string | null;
  role: "ADMIN" | "MEMBER";
  needsSetup: boolean;
}>) {
  const t = useTranslations("settings.account");
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(formData: FormData) {
    setSaving(true);
    setError(null);
    setDone(false);
    try {
      await changeOwnPassword(formData);
      setDone(true);
      router.refresh();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      // The action throws stable keys for the two expected failures so they
      // can be translated rather than surfaced as raw English.
      const known: Record<string, string> = {
        invalid_current_password: t("errorWrongPassword"),
        username_required: t("errorUsernameRequired"),
      };
      setError(known[raw] ?? raw);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-medium text-[var(--foreground)]">{t("title")}</h2>
        <p className="text-sm text-[var(--muted)] mt-1">
          {username
            ? t("signedInAs", { name: displayName ?? username, role: role === "ADMIN" ? t("roleAdmin") : t("roleMember") })
            : t("noUsernameYet")}
        </p>
      </div>

      {needsSetup && (
        <div className="flex gap-2.5 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-4 py-3">
          <TriangleAlert size={16} aria-hidden="true" className="text-[var(--warning)] shrink-0 mt-0.5" />
          <p className="text-sm text-[var(--warning)]">{t("setupNotice")}</p>
        </div>
      )}

      <form action={handleSubmit} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3">
        {!username && (
          <Input
            label={t("username")}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            placeholder={t("usernamePlaceholder")}
          />
        )}
        {/* An account with no password hash authenticated via the env
            credential, so there is nothing to verify against - asking for a
            "current password" there would be asking for the .env value, which
            is not what this field means. */}
        {!needsSetup && (
          <Input
            label={t("currentPassword")}
            name="currentPassword"
            type="password"
            autoComplete="current-password"
          />
        )}
        <Input
          label={t("newPassword")}
          name="newPassword"
          type="password"
          autoComplete="new-password"
          hint={t("passwordHint")}
        />
        <div className="flex items-center gap-3 flex-wrap">
          <Button type="submit" disabled={saving}>
            <KeyRound size={14} aria-hidden="true" />
            {saving ? t("saving") : needsSetup ? t("finishSetup") : t("changePassword")}
          </Button>
          {done && <span className="text-sm text-[var(--positive)]">{t("saved")}</span>}
          {error && <span className="text-sm text-[var(--negative)]">{error}</span>}
        </div>
      </form>
    </section>
  );
}
