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

type WaitKind = "code" | "approval" | null;

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
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const t = useTranslations("syncStatus");
  const tc = useTranslations("common");

  const isAuthRequired = log?.status === "auth_required";
  const inFlow = waitKind !== null || unsupportedMessage !== null || busy;

  if (!isAuthRequired && !inFlow) return null;

  const reset = () => {
    setBusy(false);
    setWaitKind(null);
    setHint(null);
    setUnsupportedMessage(null);
    setCode("");
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
      triggerSync();
      return;
    }
    if (result.status === "unsupported") {
      setWaitKind(null);
      setUnsupportedMessage(result.message);
      return;
    }
    setUnsupportedMessage(null);
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
        waitKind === "code" ? code : undefined,
      );
      if (!result.ok) {
        setError(result.error);
        setBusy(false);
        return;
      }
      reset();
      triggerSync();
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
