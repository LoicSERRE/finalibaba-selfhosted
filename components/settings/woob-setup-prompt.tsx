"use client";

import { useState, useTransition } from "react";
import { RefreshCw, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  startInstitutionSetup,
  completeInstitutionSetup,
  triggerInstitutionSync,
  type InstitutionSetupResult,
} from "@/lib/actions/sync";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { needsReconnection } from "@/lib/domain/sync-status";
import { RecaptchaWidget } from "./recaptcha-widget";
import { RecaptchaV3 } from "./recaptcha-v3";
import { CaptchaDomainHelp } from "./captcha-domain-help";

interface SyncLog {
  status: string;
}

// Woob's OTPSentType values (woob/exceptions.py) - "unknown" and anything
// not in this map falls back to otpMediumUnknown.
const MEDIUM_KEY: Record<string, string> = {
  sms: "otpMediumSms",
  phone_call: "otpMediumPhoneCall",
  email: "otpMediumEmail",
  mobile_app: "otpMediumMobileApp",
  device: "otpMediumDevice",
};

type WaitKind = "code" | "approval" | "captcha" | null;

// Generic counterpart to SyncStatus's LCL/TR setup flows (that component
// stays hardcoded to those two sources - see its own file) - same shape,
// driven by whatever start_setup() reports instead of a fixed source. Only
// rendered by the caller once Institution.woobModule is set; see
// app/settings/page.tsx's institution row.
export function WoobSetupPrompt({ institutionId, log }: Readonly<{ institutionId: string; log: SyncLog | null }>) {
  const [busy, setBusy] = useState(false);
  const [waitKind, setWaitKind] = useState<WaitKind>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [unsupportedMessage, setUnsupportedMessage] = useState<string | null>(null);
  const [code, setCode] = useState("");
  // The reCAPTCHA site key the bank's own login page uses, handed over by Woob
  // in the exception. Non-null is what puts the widget on screen.
  const [captchaSiteKey, setCaptchaSiteKey] = useState<string | null>(null);
  // v3 is invisible: nothing is rendered for the user to act on, the token is
  // fetched on mount. Kept beside the key so the panel knows which to show.
  const [captchaV3, setCaptchaV3] = useState<{ action: string; enterprise: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const t = useTranslations("syncStatus");
  const tc = useTranslations("common");

  // Both auth_required and captcha_required mean "a human can fix this
  // from here" - the difference matters to the alert path, not to this
  // button. See lib/domain/sync-status.ts.
  const isAuthRequired = needsReconnection(log?.status);
  const inFlow = waitKind !== null || unsupportedMessage !== null || busy;

  if (!isAuthRequired && !inFlow) return null;

  const reset = () => {
    setBusy(false);
    setWaitKind(null);
    setHint(null);
    setUnsupportedMessage(null);
    setCode("");
    setCaptchaSiteKey(null);
    setCaptchaV3(null);
    setError(null);
  };

  const triggerSync = () => {
    startTransition(async () => {
      const result = await triggerInstitutionSync(institutionId);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  };

  const applyResult = (result: InstitutionSetupResult) => {
    // The sync service refused or was unreachable. Carried as a value rather
    // than thrown because Next redacts a thrown Server Action error in
    // production - the reason would reach the user in dev and nowhere else.
    if (result.status === "failed") {
      setWaitKind(null);
      setError(result.error);
      return;
    }
    if (result.status === "already_connected") {
      reset();
      // The setup writes the accounts itself, with the session the user just
      // authorised. Re-syncing here would re-login, which an MFA bank refuses
      // outside an interactive session - the failure then overwrote the
      // success and the row went back to showing "Connect" with a warning
      // triangle seconds after it had actually worked (issue #51).
      if (result.synced === undefined) triggerSync();
      else router.refresh();
      return;
    }
    if (result.status === "captcha_required") {
      // A captcha with no site key cannot be rendered, so say so plainly
      // instead of showing an empty box. Only reachable if a future Woob stops
      // carrying the field.
      if (!result.website_key) {
        setWaitKind(null);
        setUnsupportedMessage(result.message ?? t("woobCaptchaNoKey"));
        return;
      }
      setUnsupportedMessage(null);
      setCode("");
      setCaptchaSiteKey(result.website_key);
      setCaptchaV3(
        result.captcha_kind === "v3"
          ? { action: result.captcha_action || "login", enterprise: !!result.captcha_enterprise }
          : null,
      );
      setWaitKind("captcha");
      return;
    }
    if (result.status === "unsupported") {
      setWaitKind(null);
      setUnsupportedMessage(result.message);
      return;
    }
    setUnsupportedMessage(null);
    // A captcha token is single-use, so once the flow has moved past it the
    // key on screen is spent - keep it out of state rather than leaving a
    // stale one a later render could pick up.
    setCaptchaSiteKey(null);
    setHint(result.medium_type ? t(MEDIUM_KEY[result.medium_type] ?? "otpMediumUnknown") : (result.message ?? null));
    setWaitKind(result.status === "code_required" ? "code" : "approval");
  };

  const handleStart = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await startInstitutionSetup(institutionId);
      applyResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unknownError"));
    } finally {
      setBusy(false);
    }
  };

  const handleComplete = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await completeInstitutionSetup(
        institutionId,
        waitKind === "approval" ? undefined : code || undefined,
      );
      if (!result.ok) {
        setError(result.error);
        setBusy(false);
        // A captcha token is single-use, so the widget on screen is spent and
        // retrying with it can only fail again. Drop back to the Connect
        // button - the next attempt fetches a fresh challenge - rather than
        // leaving a button whose only possible outcome is the same error.
        if (waitKind === "captcha") {
          setWaitKind(null);
          setCaptchaSiteKey(null);
          setCode("");
        }
        return;
      }
      // The bank can answer a completed step with another step rather than
      // with a session - Amundi follows a solved captcha with a phone
      // approval. Route it through the very same applyResult the start path
      // uses, so the right panel appears and the user can confirm once they
      // have approved on their phone. Treating it as success here would
      // report a connection that never happened; treating it as failure (what
      // it did before) left no way back to the approval panel at all.
      if (result.status === "pending_approval") {
        applyResult({
          status: "pending_approval",
          medium_type: result.medium_type,
          medium_label: result.medium_label,
          message: result.message,
        });
        setBusy(false);
        return;
      }
      if (result.status === "code_required") {
        applyResult({
          status: "code_required",
          medium_type: result.medium_type,
          medium_label: result.medium_label,
          message: result.message,
        });
        setBusy(false);
        return;
      }
      reset();
      // `in` rather than a property read: the two continuation statuses were
      // returned above, but TypeScript keeps the union because `status` is
      // itself a union on that variant, so `result.synced` is not narrowed.
      const alreadyWritten = "synced" in result && result.synced !== undefined;
      if (alreadyWritten) router.refresh();
      else triggerSync();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unknownError"));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      {!inFlow && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleStart}
          className="border-[var(--warning)]/40 text-[var(--warning)] hover:bg-[var(--warning)]/10"
        >
          <LogIn size={12} aria-hidden="true" />
          {t("connect")}
        </Button>
      )}

      {busy && waitKind === null && !unsupportedMessage && (
        <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
          <RefreshCw size={12} className="animate-spin" aria-hidden="true" />
          {t("connecting")}
        </span>
      )}

      {waitKind === "code" && (
        <div className="w-full p-3 rounded-lg bg-[var(--surface-elevated)] border border-[var(--warning)]/20">
          {hint && <p className="text-xs text-[var(--muted)] mb-2">{hint}</p>}
          <p className="text-xs text-[var(--muted)] mb-2">{t("woobCodeHint")}</p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleComplete()}
              disabled={busy}
              aria-label={t("woobCodeAriaLabel")}
              className="w-24 text-center text-lg font-mono tracking-[0.2em] px-2 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
            />
            <Button size="sm" onClick={handleComplete} disabled={!code.trim() || busy}>
              {busy ? (
                <>
                  <RefreshCw size={12} className="animate-spin" aria-hidden="true" /> {t("validating")}
                </>
              ) : (
                t("confirm")
              )}
            </Button>
            <Button variant="ghost" size="sm" onClick={reset}>
              {tc("cancel")}
            </Button>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-xs text-[var(--negative)]">
              {error}
            </p>
          )}
        </div>
      )}

      {waitKind === "captcha" && captchaSiteKey && (
        <div className="w-full p-3 rounded-lg bg-[var(--surface-elevated)] border border-[var(--warning)]/20">
          {/* v3 asks the user for nothing, so the checkbox instructions would
              be a lie there. Both still need a human present, because the token
              is single-use and short-lived. */}
          <p className="text-xs text-[var(--muted)] mb-1">
            {captchaV3 ? t("woobCaptchaV3Hint") : t("woobCaptchaHint")}
          </p>
          {/* Stated up front, not discovered later: this bank will need the
              same step on every sync, because the token is single-use. */}
          <p className="text-xs text-[var(--muted)] mb-3">{t("woobCaptchaManualOnly")}</p>
          {/* Google refuses the widget outright when the bank restricts its
              key to its own domain (Amundi does). Nothing here can fix that,
              so the error is explained rather than left looking like our bug.
              Only the visible checkbox can show that error, so v3 skips it. */}
          {!captchaV3 && (
            <>
              <p className="text-xs text-[var(--muted)] mb-3">{t("woobCaptchaDomainNote")}</p>
              {/* The way out, for the case that note describes. Renders nothing
                  on localhost, where it is already irrelevant. */}
              <CaptchaDomainHelp command={t("woobCaptchaDomainHelpCommand")} />
            </>
          )}
          {captchaV3 ? (
            <RecaptchaV3
              siteKey={captchaSiteKey}
              action={captchaV3.action}
              enterprise={captchaV3.enterprise}
              loadingLabel={t("woobCaptchaLoading")}
              onToken={setCode}
              onUnavailable={() => {
                setWaitKind(null);
                setUnsupportedMessage(t("woobCaptchaUnavailable"));
              }}
            />
          ) : (
            <RecaptchaWidget
              siteKey={captchaSiteKey}
              loadingLabel={t("woobCaptchaLoading")}
              onToken={setCode}
              onUnavailable={() => {
                setWaitKind(null);
                setUnsupportedMessage(t("woobCaptchaUnavailable"));
              }}
            />
          )}
          <div className="flex items-center gap-2 mt-3">
            <Button size="sm" onClick={handleComplete} disabled={!code || busy}>
              {busy ? (
                <>
                  <RefreshCw size={12} className="animate-spin" aria-hidden="true" /> {t("validating")}
                </>
              ) : (
                t("confirm")
              )}
            </Button>
            <Button variant="ghost" size="sm" onClick={reset}>
              {tc("cancel")}
            </Button>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-xs text-[var(--negative)]">
              {error}
            </p>
          )}
        </div>
      )}

      {waitKind === "approval" && (
        <div className="w-full p-3 rounded-lg bg-[var(--surface-elevated)] border border-[var(--warning)]/20">
          <p className="text-xs text-[var(--muted)] mb-3">{hint ?? t("woobApprovalHint")}</p>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleComplete} disabled={busy}>
              {busy ? (
                <>
                  <RefreshCw size={12} className="animate-spin" aria-hidden="true" /> {t("validating")}
                </>
              ) : (
                t("woobConfirm")
              )}
            </Button>
            <Button variant="ghost" size="sm" onClick={reset}>
              {tc("cancel")}
            </Button>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-xs text-[var(--negative)]">
              {error}
            </p>
          )}
        </div>
      )}

      {unsupportedMessage && (
        <div className="w-full p-3 rounded-lg bg-[var(--surface-elevated)] border border-[var(--negative)]/20">
          <p className="text-xs text-[var(--negative)] mb-1">{t("woobUnsupported")}</p>
          <p className="text-xs text-[var(--muted)]">{unsupportedMessage}</p>
        </div>
      )}

      {error && !waitKind && (
        <p role="alert" className="text-xs text-[var(--negative)]">
          {error}
        </p>
      )}
    </div>
  );
}
