"use client";

import { useEffect } from "react";

// Registers public/sw.js once on mount - see that file's own comment for
// the caching strategy, and the two query params this passes it.
// Silently no-ops when unsupported (older Safari) or when registration
// fails for any reason (e.g. a dev server reached over plain HTTP on a
// non-localhost host, where the Service Worker API is unavailable) - this
// is a progressive enhancement, never required for the app to work.
//
// `userId` namespaces the runtime cache (v2.0). A different value produces a
// different script URL, which the browser treats as a different worker: it
// installs, activates, and its activate handler evicts every other user's
// bucket. That's what makes logging in as someone else on a shared browser
// drop the previous user's cached pages instead of serving them.
export function ServiceWorkerRegistration({
  offlinePages,
  userId,
}: Readonly<{ offlinePages: boolean; userId: string }>) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const params = new URLSearchParams({ offlinePages: offlinePages ? "1" : "0", u: userId });
    navigator.serviceWorker.register(`/sw.js?${params}`).catch(() => {});
  }, [offlinePages, userId]);

  // Clears the app-icon badge public/sw.js sets when a push arrives. Opening
  // the app IS the read receipt - this app stores no read/unread state, so
  // there is nothing else that could clear it. Also on visibilitychange, not
  // just mount: an installed PWA is resumed far more often than it is
  // cold-started, and a badge that only cleared on a fresh load would sit
  // there for days.
  useEffect(() => {
    const clear = () => {
      if (document.visibilityState === "visible") {
        navigator.clearAppBadge?.().catch(() => {});
      }
    };
    clear();
    document.addEventListener("visibilitychange", clear);
    return () => document.removeEventListener("visibilitychange", clear);
  }, []);

  return null;
}
