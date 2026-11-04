import { ShieldAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { TwoFactorSection } from "@/components/settings/two-factor-section";
import { LogoutButton } from "@/components/layout/logout-button";

/**
 * Shown instead of the app when the instance requires TOTP and this user has
 * not set it up.
 *
 * **A server-side gate, unlike AppLockGate.** App-lock is a client overlay in
 * front of data the page already sent, which is proportionate for "somebody
 * picked up my unlocked phone". This one is a policy the operator set, so the
 * page content must not be sent at all - the layout renders this INSTEAD of
 * the sidebar and children, so no RSC payload for a real page is produced.
 * Server Actions and API routes are refused separately, by getViewer.
 *
 * The setup itself is here rather than behind a link to Settings: that page
 * used to be exempt from the gate so the link had somewhere to go, and with it
 * the API keys and share links it lists. Nothing is exempt now. Confirming the
 * code does not refresh the page - the backup codes are shown first, and
 * dismissing them is what refreshes and lifts the gate.
 */
export async function TwoFactorRequired() {
  const t = await getTranslations("auth.twoFactorRequired");

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center px-4 py-10 gap-6">
      <div className="w-full max-w-lg bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 space-y-5">
        <div className="space-y-1.5 text-center">
          <ShieldAlert size={28} className="mx-auto text-[var(--warning)]" aria-hidden="true" />
          <h1 className="text-lg font-medium text-[var(--foreground)]">{t("title")}</h1>
          <p className="text-sm text-[var(--muted)]">{t("body")}</p>
        </div>
        <TwoFactorSection totpEnabled={false} />
        <div className="flex justify-center">
          <LogoutButton />
        </div>
      </div>
    </div>
  );
}
