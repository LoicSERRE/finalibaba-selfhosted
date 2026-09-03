"use client";

import { useEffect, useRef, useState } from "react";
import { withTimeout } from "@/lib/utils/with-timeout";

/**
 * The real Google reCAPTCHA v2 checkbox, rendered so a HUMAN can solve the
 * challenge a bank puts in front of its login.
 *
 * This exists because "a captcha defeats automation" is true and beside the
 * point. Woob's Amundi module raises RecaptchaV2Question only when nothing has
 * supplied an answer; hand it a solved token through `captcha_response` and the
 * login proceeds normally. The alternative way to fill that field is a paid
 * solving service, which means shipping someone else's bank login challenge to
 * a third party - deliberately not done here. A person clicking a checkbox in
 * their own browser is the same mechanism without that cost.
 *
 * The honest limit, surfaced in the UI rather than buried: a solved token is
 * single-use and expires in roughly two minutes. This makes ON-DEMAND sync work
 * and can never make the 4h cron work.
 *
 * Callbacks are kept in refs rather than in the effect's dependency list: the
 * widget is imperative and must be rendered exactly once, so re-running the
 * effect because the parent re-rendered with a fresh arrow function would leave
 * a second checkbox in the DOM.
 */

type Grecaptcha = {
  render: (
    container: HTMLElement,
    params: {
      sitekey: string;
      theme: "dark" | "light";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => number;
};

/**
 * Google renders a white box by default, which reads as a broken element on
 * this app's dark palette. Resolved the same way globals.css does: an explicit
 * choice is stamped on <html> as data-theme, and "auto" (the third setting)
 * stamps nothing and defers to the OS - so an absent attribute means asking
 * prefers-color-scheme, not assuming light. Read once at render because the
 * widget is imperative and cannot be re-themed after the fact; a theme change
 * mid-ceremony is not worth tearing down a half-solved captcha for.
 */
function resolveTheme(): "dark" | "light" {
  const stamped = document.documentElement.dataset.theme;
  if (stamped === "dark" || stamped === "light") return stamped;
  return globalThis.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

declare global {
  var grecaptcha: Grecaptcha | undefined;
}

const READY_CALLBACK = "__finalibabaRecaptchaReady";

/** Module-level so several mounts share one <script>; Google's api.js is not
 *  safe to add twice. */
let scriptPromise: Promise<void> | null = null;

function loadRecaptchaScript(): Promise<void> {
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    if (globalThis.grecaptcha?.render) {
      resolve();
      return;
    }
    // `render=explicit` + an `onload` callback name is Google's documented
    // contract for rendering into a container we choose. Waiting on the
    // <script> tag's own onload instead is a race: the tag fires before
    // grecaptcha.render is necessarily assigned.
    (globalThis as unknown as Record<string, () => void>)[READY_CALLBACK] = () => resolve();
    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/api.js?onload=${READY_CALLBACK}&render=explicit`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      // Let a later attempt retry rather than caching the failure forever -
      // this is the offline/blocked-by-an-extension case, which resolves on
      // its own once the network or the blocker does.
      scriptPromise = null;
      reject(new Error("recaptcha_unreachable"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** Google's script is fetched from the open internet by the viewer's own
 *  browser, so it can hang on a captive network or be swallowed by an
 *  extension. 20s, matching the app-lock Server Action ceiling. */
const SCRIPT_TIMEOUT_MS = 20_000;

export function RecaptchaWidget({
  siteKey,
  loadingLabel,
  onToken,
  onUnavailable,
}: Readonly<{
  siteKey: string;
  /** Shown while Google's script is still on its way. */
  loadingLabel: string;
  /** Empty string when the token expired and must be solved again. */
  onToken: (token: string) => void;
  onUnavailable: () => void;
}>) {
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(false);
  const onTokenRef = useRef(onToken);
  const onUnavailableRef = useRef(onUnavailable);

  useEffect(() => {
    onTokenRef.current = onToken;
    onUnavailableRef.current = onUnavailable;
  }, [onToken, onUnavailable]);

  useEffect(() => {
    let cancelled = false;
    // Without a deadline this promise can stay pending forever - a blocked or
    // stalled script leaves an empty box and NO message, which is exactly what
    // was reported from a real instance. Same lesson app-lock already learned:
    // a stall must name itself rather than look like nothing happening.
    withTimeout(loadRecaptchaScript(), SCRIPT_TIMEOUT_MS, "recaptcha_script_timeout")
      .then(() => {
        // renderedRef guards React's development double-mount: the ref survives
        // it, so grecaptcha.render is never called twice on one container
        // (which throws).
        if (cancelled || renderedRef.current || !containerRef.current) return;
        if (!globalThis.grecaptcha?.render) {
          onUnavailableRef.current();
          return;
        }
        renderedRef.current = true;
        setLoading(false);
        globalThis.grecaptcha.render(containerRef.current, {
          sitekey: siteKey,
          theme: resolveTheme(),
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(""),
          // NOT onUnavailable. This fires on a transient network hiccup
          // reaching Google, and the widget recovers from it by itself - it
          // shows its own error and stays clickable. Treating it as fatal tore
          // the whole panel down and replaced a working checkbox with "the
          // captcha could not load", which was observed happening in testing
          // to a widget that had in fact loaded. Clearing the token is enough:
          // Confirm stays disabled until a real solve arrives.
          "error-callback": () => onTokenRef.current(""),
        });
      })
      .catch(() => {
        if (!cancelled) onUnavailableRef.current();
      });
    return () => {
      cancelled = true;
    };
  }, [siteKey]);

  return (
    <>
      {/* Something to look at while the script is in flight, so an empty gap
          never reads as a finished, broken panel. */}
      {loading && <p className="text-xs text-[var(--muted)]">{loadingLabel}</p>}
      {/* Left-aligned like the panel's own text and its Confirm button - the
          surrounding column right-aligns, which left the checkbox marooned
          across a gap from everything it belongs to. */}
      <div ref={containerRef} />
    </>
  );
}
