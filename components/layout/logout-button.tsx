"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Signs out, after clearing the service worker's runtime cache: it caches
 * successful GET responses whatever the auth mode, so a shared device should
 * not keep real financial data in Cache Storage after an explicit logout,
 * even though it never serves that cache back in this mode (see public/sw.js).
 *
 * Shared by the desktop sidebar and the phone's Settings header - the phone
 * had no way to sign out at all, since the bottom nav has no room for it.
 */
export async function signOutClearingCache() {
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  const { signOut } = await import("next-auth/react");
  await signOut({ callbackUrl: "/login" });
}

export function LogoutButton({ className = "" }: Readonly<{ className?: string }>) {
  const t = useTranslations("nav");
  return (
    <button
      type="button"
      onClick={() => void signOutClearingCache()}
      className={`flex items-center gap-3 px-3 py-2 min-h-11 rounded-lg text-sm font-medium text-[var(--muted)] hover:text-[var(--negative)] hover:bg-[var(--surface-elevated)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${className}`}
    >
      <LogOut size={16} aria-hidden="true" />
      {t("logout")}
    </button>
  );
}
