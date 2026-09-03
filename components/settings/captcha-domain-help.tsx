"use client";

import { useState, useSyncExternalStore } from "react";
import { Copy, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { copyToClipboard } from "@/lib/utils/clipboard";

/**
 * What to do when a bank's reCAPTCHA key refuses the domain you reach this app
 * on.
 *
 * The situation, confirmed on a real instance: Amundi's site key restricts its
 * allowed domains, so Google renders its own red "Domaine non valide pour la
 * clé de site" inside the widget and there is nothing the app can do about it.
 * But their allow-list also contains `localhost` - apparently a leftover from
 * their own development - so reaching this app at localhost makes the very same
 * key render normally. An SSH tunnel does that without changing anything about
 * the deployment.
 *
 * **Why this is offered and forging the origin is not.** Both make the widget
 * appear. The difference is that a tunnel genuinely serves the page from
 * localhost - the browser's origin really is what it reports - whereas
 * declaring the bank's own origin in reCAPTCHA's `co=` parameter tells Google
 * something untrue in order to use a key on a host its owner did not authorise.
 * One uses an origin the bank allows; the other misrepresents which page is
 * asking.
 *
 * Hidden entirely when already on localhost, where the advice is noise, and
 * collapsed by default everywhere else: most people opening this panel are on a
 * bank whose key is not restricted at all and will never see the error this
 * explains.
 */

/** Reading location during render would risk a hydration mismatch, and this
 *  repo has been bitten by exactly that before (see formatDateShort). A
 *  subscribe that never fires is the sanctioned shape for a one-shot browser
 *  read - the lint config rejects useEffect+useState for it. The server
 *  snapshot claims localhost so the block is simply absent from server HTML. */
const NO_SUBSCRIBE = () => () => {};

function useIsLocalhost(): boolean {
  return useSyncExternalStore(
    NO_SUBSCRIBE,
    () => globalThis.location?.hostname === "localhost",
    () => true,
  );
}

export function CaptchaDomainHelp({ command }: Readonly<{ command: string }>) {
  const t = useTranslations("syncStatus");
  const isLocalhost = useIsLocalhost();
  const [copied, setCopied] = useState(false);

  if (isLocalhost) return null;

  const handleCopy = async () => {
    if (!(await copyToClipboard(command))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <details className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <summary className="cursor-pointer text-xs text-[var(--muted)] hover:text-[var(--foreground)] min-h-[44px] flex items-center">
        {t("woobCaptchaDomainHelpSummary")}
      </summary>
      <div className="mt-2 space-y-2">
        <p className="text-xs text-[var(--muted)]">{t("woobCaptchaDomainHelpBody")}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <code className="flex-1 min-w-[220px] overflow-x-auto rounded bg-[var(--surface-elevated)] border border-[var(--border)] px-2 py-1.5 text-xs font-mono text-[var(--foreground)]">
            {command}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            aria-label={t("woobCaptchaCopyCommand")}
            className="inline-flex items-center gap-1 min-h-[44px] px-2 rounded text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
            {copied ? t("woobCaptchaCopied") : t("woobCaptchaCopyCommand")}
          </button>
        </div>
        <p className="text-xs text-[var(--muted)]">{t("woobCaptchaDomainHelpThen")}</p>
        {/* Stated here rather than discovered later: the tunnel buys a manual
            sync, never an automatic one. */}
        <p className="text-xs text-[var(--muted)]">{t("woobCaptchaDomainHelpCaveat")}</p>
      </div>
    </details>
  );
}
