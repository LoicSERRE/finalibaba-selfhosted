"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Shown when the signed-in account no longer exists, and signs the browser out
 * on sight.
 *
 * The session cookie stays cryptographically valid for its full 30 days after
 * an admin deletes an account, so the browser keeps presenting it and the
 * middleware keeps accepting it. Clearing it is the only thing that resolves
 * the state, and only the client can do that - which is why this is a
 * component rather than a redirect inside getViewer, where it would loop
 * against /login.
 *
 * Rendered instead of the page, never alongside it: whatever the user was
 * looking at belonged to an account that is gone.
 */
export function SessionEnded() {
  const t = useTranslations("auth");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { signOut } = await import("next-auth/react");
        await signOut({ callbackUrl: "/login" });
      } catch {
        // Offline, or the chunk cannot load. The manual link below is then the
        // way out, rather than a spinner that never resolves.
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[var(--background)] flex flex-col items-center justify-center px-4 text-center">
      <div className="w-full max-w-sm space-y-3">
        <h1 className="text-lg font-semibold text-[var(--foreground)]">{t("sessionEndedTitle")}</h1>
        <p className="text-sm text-[var(--muted)]">{t("sessionEndedBody")}</p>
        {failed && (
          <a
            href="/login"
            className="inline-block text-sm font-medium text-[var(--accent-text)] underline underline-offset-4"
          >
            {t("sessionEndedLink")}
          </a>
        )}
      </div>
    </div>
  );
}
