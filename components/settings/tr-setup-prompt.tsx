"use client";

import { useEffect, useState, useTransition } from "react";
import { RefreshCw, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  startInstitutionSetup,
  completeInstitutionSetup,
  triggerInstitutionSync,
} from "@/lib/actions/sync";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

interface SyncLog {
  status: string;
}

/**
 * Establish a Trade Republic session for one institution (v2.1).
 *
 * The counterpart to WoobSetupPrompt, and deliberately its own component
 * rather than a branch inside it: Trade Republic has exactly one second
 * factor (a code pushed to its own mobile app), so none of Woob's three
 * outcome families - approval-only, code, unsupported - apply. What it does
 * have and Woob does not is an expiry: TR reports how long the code stays
 * valid, and a user who does not know the code has expired just sees it
 * rejected with no explanation.
 *
 * Rendered by app/settings/page.tsx for an institution carrying trPhone,
 * exactly where WoobSetupPrompt is rendered for one carrying woobModule.
 */
export function TradeRepublicSetupPrompt({
  institutionId,
  log,
}: Readonly<{ institutionId: string; log: SyncLog | null }>) {
  const [busy, setBusy] = useState(false);
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const t = useTranslations("syncStatus");
  const tc = useTranslations("common");

  // One interval for the whole countdown, cleared on unmount and whenever the
  // flow resets - not a timeout re-armed per tick, which would leak one timer
  // per second if the user navigated away mid-setup.
  useEffect(() => {
    if (secondsLeft === null) return;
    if (secondsLeft <= 0) return;
    const id = setInterval(() => {
      setSecondsLeft((s) => (s === null ? null : Math.max(0, s - 1)));
    }, 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  const isAuthRequired = log?.status === "auth_required";
  const inFlow = awaitingCode || busy;

  if (!isAuthRequired && !inFlow) return null;

  const reset = () => {
    setBusy(false);
    setAwaitingCode(false);
    setSecondsLeft(null);
    setCode("");
    setError(null);
  };

  const triggerSync = () => {
    startTransition(async () => {
      await triggerInstitutionSync(institutionId);
      router.refresh();
    });
  };

  const handleStart = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await startInstitutionSetup(institutionId);
      // A session that still resumes needs no code at all: the sync service
      // reports that instead of pushing a pointless notification.
      if (result.status === "already_connected") {
        reset();
        triggerSync();
        return;
      }
      setAwaitingCode(true);
      setSecondsLeft(result.status === "code_required" ? (result.countdown ?? null) : null);
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
      await completeInstitutionSetup(institutionId, code);
      reset();
      triggerSync();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unknownError"));
      setBusy(false);
    }
  };

  const expired = secondsLeft !== null && secondsLeft <= 0;

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

      {busy && !awaitingCode && (
        <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
          <RefreshCw size={12} className="animate-spin" aria-hidden="true" />
          {t("connecting")}
        </span>
      )}

      {awaitingCode && (
        <div className="w-full p-3 rounded-lg bg-[var(--surface-elevated)] border border-[var(--warning)]/20">
          <p className="text-xs text-[var(--muted)] mb-2">{t("trCodeHint")}</p>
          {secondsLeft !== null && (
            <p className={`text-xs mb-2 ${expired ? "text-[var(--negative)]" : "text-[var(--muted)]"}`}>
              {expired ? t("trCodeExpired") : t("trCodeCountdown", { seconds: secondsLeft })}
            </p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && code.trim() && !busy && handleComplete()}
              disabled={busy}
              aria-label={t("trCodeAriaLabel")}
              className="w-24 text-center text-lg font-mono tracking-[0.2em] px-2 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
            />
            {expired ? (
              <Button size="sm" onClick={handleStart} disabled={busy}>
                {t("trResend")}
              </Button>
            ) : (
              <Button size="sm" onClick={handleComplete} disabled={!code.trim() || busy}>
                {busy ? (
                  <>
                    <RefreshCw size={12} className="animate-spin" aria-hidden="true" /> {t("validating")}
                  </>
                ) : (
                  t("confirm")
                )}
              </Button>
            )}
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

      {error && !awaitingCode && (
        <p role="alert" className="text-xs text-[var(--negative)]">
          {error}
        </p>
      )}
    </div>
  );
}
