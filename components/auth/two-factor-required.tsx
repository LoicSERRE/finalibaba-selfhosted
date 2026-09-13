import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * Shown instead of the app when the instance requires TOTP and this user has
 * not set it up.
 *
 * **A server-side gate, unlike AppLockGate.** App-lock is a client overlay in
 * front of data the page already sent, which is proportionate for "somebody
 * picked up my unlocked phone". This one is a policy the operator set, so the
 * page content must not be sent at all - the layout renders this INSTEAD of
 * the sidebar and children, so no RSC payload for a real page is produced.
 *
 * Deliberately not a redirect: the layout renders on every route including
 * /settings itself, and redirecting from there would loop the user away from
 * the one page that can clear the condition. Linking instead leaves Settings
 * reachable, which is exactly where the setup lives.
 */
export async function TwoFactorRequired() {
  const t = await getTranslations("auth.twoFactorRequired");

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center px-4 py-10 gap-6">
      <div className="w-full max-w-sm bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 space-y-4 text-center">
        <ShieldAlert size={28} className="mx-auto text-[var(--warning)]" aria-hidden="true" />
        <div className="space-y-1.5">
          <h1 className="text-lg font-medium text-[var(--foreground)]">{t("title")}</h1>
          <p className="text-sm text-[var(--muted)]">{t("body")}</p>
        </div>
        <Link
          href="/settings"
          className="inline-block w-full px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
        >
          {t("action")}
        </Link>
      </div>
    </div>
  );
}
