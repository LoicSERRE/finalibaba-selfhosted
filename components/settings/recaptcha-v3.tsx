"use client";

import { useEffect, useState } from "react";
import { withTimeout } from "@/lib/utils/with-timeout";
// One global object, one type - declaring `grecaptcha` twice is a TS conflict.
import type { Grecaptcha } from "./recaptcha-widget";

/**
 * reCAPTCHA v3 / Enterprise: invisible, and therefore NOT a smaller version of
 * the checkbox.
 *
 * v2 asks a human to prove something. v3 asks nothing: Google scores the
 * session from behaviour and hands back a token. There is no widget, no click,
 * and nothing to render - so this component fetches the token on mount and
 * reports it, showing only a line of text while it does.
 *
 * Rendering the v2 checkbox for a v3 site key is what happened before this
 * existed, and Google answers that with "Invalid input" - a permanently broken
 * box on Swile and CMES, the two banks in the catalogue that use v3.
 *
 * Enterprise is a different script AND a different namespace
 * (`grecaptcha.enterprise.execute`), which is why the exception carries
 * `is_enterprise` rather than letting us guess.
 */

/** Same ceiling as the v2 widget: Google's script is fetched from the open
 *  internet by the viewer's browser, so it can hang or be blocked. */
const SCRIPT_TIMEOUT_MS = 20_000;

function loadScript(siteKey: string, enterprise: boolean): Promise<void> {
  const src = enterprise
    ? `https://www.google.com/recaptcha/enterprise.js?render=${siteKey}`
    : `https://www.google.com/recaptcha/api.js?render=${siteKey}`;

  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onerror = () => reject(new Error("recaptcha_v3_script_failed"));
    script.onload = () => resolve();
    document.head.appendChild(script);
  });
}

/** Bridges grecaptcha's callback-based `ready` to a promise.
 *
 *  Module level rather than inside the component: nested inside the effect it
 *  sat five function levels deep, which sonarjs/no-nested-functions rejects -
 *  and it has nothing to do with React, so it does not belong there anyway.
 */
function executeV3(siteKey: string, action: string, enterprise: boolean): Promise<string> {
  const g: Grecaptcha | undefined = globalThis.grecaptcha;
  const api = enterprise ? g?.enterprise : g;
  if (!api?.ready || !api.execute) return Promise.reject(new Error("recaptcha_v3_missing"));
  const { ready, execute } = api;
  return new Promise<string>((resolve, reject) => {
    ready(() => execute(siteKey, { action }).then(resolve, reject));
  });
}

export function RecaptchaV3({
  siteKey,
  action,
  enterprise,
  loadingLabel,
  onToken,
  onUnavailable,
}: Readonly<{
  siteKey: string;
  /** The action the bank's own page declares; "login" is Woob's usual default. */
  action: string;
  enterprise: boolean;
  loadingLabel: string;
  onToken: (token: string) => void;
  onUnavailable: () => void;
}>) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    withTimeout(loadScript(siteKey, enterprise), SCRIPT_TIMEOUT_MS, "recaptcha_v3_timeout")
      .then(() => executeV3(siteKey, action, enterprise))
      .then((token) => {
        if (!cancelled) onToken(token);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        onUnavailable();
      });

    return () => {
      cancelled = true;
    };
    // Runs once per key: re-executing would silently replace a token the user
    // is about to submit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, action, enterprise]);

  if (failed) return null;
  return <p className="text-xs text-[var(--muted)]">{loadingLabel}</p>;
}
