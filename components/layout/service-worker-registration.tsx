"use client";

import { useEffect } from "react";

// Registers public/sw.js once on mount - see that file's own comment for
// the caching strategy, and the offlinePages query param this passes it.
// Silently no-ops when unsupported (older Safari) or when registration
// fails for any reason (e.g. a dev server reached over plain HTTP on a
// non-localhost host, where the Service Worker API is unavailable) - this
// is a progressive enhancement, never required for the app to work.
export function ServiceWorkerRegistration({ offlinePages }: Readonly<{ offlinePages: boolean }>) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(`/sw.js?offlinePages=${offlinePages ? "1" : "0"}`).catch(() => {});
  }, [offlinePages]);

  return null;
}
