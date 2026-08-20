"use client";

import { useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getSnapshot() {
  return !navigator.onLine;
}

// navigator doesn't exist during SSR - never render the banner there, the
// client re-renders with the real value on hydration if actually offline.
function getServerSnapshot() {
  return false;
}

// Purely a navigator.onLine indicator, independent of the service worker's
// own caching logic (public/sw.js) - simpler and more robust than trying to
// thread a custom "served from cache" signal back from the SW. Honest
// framing matters for a wealth-tracking app: a stale cached balance shown
// with no indication it might be out of date would be actively misleading,
// not just a missing feature.
export function OfflineBanner() {
  const isOffline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const t = useTranslations("common");

  if (!isOffline) return null;

  return (
    <div className="flex items-center justify-center gap-2 text-xs text-[var(--warning)] bg-[var(--warning)]/10 border-b border-[var(--warning)]/30 px-4 py-2">
      <WifiOff size={14} className="shrink-0" aria-hidden="true" />
      <span>{t("offlineNotice")}</span>
    </div>
  );
}
