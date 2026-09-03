"use client";

import { useState, useTransition } from "react";
import { RefreshCw, CheckCircle, AlertTriangle, Clock, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { triggerSync, startTRSetup, completeTRSetup, startLCLSetup, completeLCLSetup } from "@/lib/actions/sync";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { needsReconnection } from "@/lib/domain/sync-status";

interface SyncLog {
  status: string;
  message: string | null;
  createdAt: Date;
}

interface Props {
  source: "lcl" | "trade-republic";
  label: string;
  log: SyncLog | null;
}

function StatusIcon({ status }: Readonly<{ status: string }>) {
  if (status === "success") return <CheckCircle size={14} className="text-[var(--positive)]" aria-hidden="true" />;
  if (needsReconnection(status)) return <AlertTriangle size={14} className="text-[var(--warning)]" aria-hidden="true" />;
  return <AlertTriangle size={14} className="text-[var(--negative)]" aria-hidden="true" />;
}

function timeAgo(date: Date, locale: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (h > 0) return rtf.format(-h, "hour");
  if (m > 0) return rtf.format(-m, "minute");
  return rtf.format(0, "second");
}

type SetupStep =
  | "idle"
  | "starting"
  | "awaiting_code"
  | "submitting"
  | "awaiting_approval"
  | "completing";

export function SyncStatus({ source, label, log }: Readonly<Props>) {
  const [pending, startTransition] = useTransition();
  const [setupStep, setSetupStep] = useState<SetupStep>("idle");
  const [code, setCode] = useState("");
  const [setupError, setSetupError] = useState<string | null>(null);
  // Separate from setupError - the "Synchroniser" click was the one path in
  // this component with no error handling at all (every setup step already
  // had its own try/catch). A hung sync (no internet reaching the bank from
  // inside the sync container, or a stuck Woob session) used to leave this
  // button spinning with zero feedback until lib/actions/sync.ts's new
  // 2-minute timeout was added - this state is what actually surfaces that
  // error once it fires, instead of it disappearing into an unhandled
  // rejection. Kept distinct from setupError since it's not part of the
  // setup flow's own state machine and shouldn't reset/interact with it.
  const [syncError, setSyncError] = useState<string | null>(null);
  const router = useRouter();
  const t = useTranslations("syncStatus");
  const tc = useTranslations("common");
  const locale = useLocale();

  const isAuthRequired = log?.status === "auth_required";
  const inSetupFlow = setupStep !== "idle";

  const reset = () => { setSetupStep("idle"); setCode(""); setSetupError(null); };

  const handleSync = () => {
    setSyncError(null);
    startTransition(async () => {
      try {
        await triggerSync(source);
        router.refresh();
      } catch (e) {
        setSyncError(e instanceof Error ? e.message : t("unknownError"));
      }
    });
  };

  // ── TR flow ──────────────────────────────────────────────────────────────────

  const handleStartTRSetup = async () => {
    setSetupStep("starting");
    setSetupError(null);
    try {
      await startTRSetup();
      setSetupStep("awaiting_code");
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : t("unknownError"));
      setSetupStep("idle");
    }
  };

  const handleCompleteTRSetup = async () => {
    if (!code.trim()) return;
    setSetupStep("submitting");
    setSetupError(null);
    try {
      await completeTRSetup(code.trim());
      setCode("");
      setSetupStep("idle");
      handleSync();
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : t("unknownError"));
      setSetupStep("awaiting_code");
    }
  };

  // ── LCL flow ─────────────────────────────────────────────────────────────────

  const handleStartLCLSetup = async () => {
    setSetupStep("starting");
    setSetupError(null);
    try {
      const result = await startLCLSetup();
      if (result.status === "already_connected") {
        setSetupStep("idle");
        handleSync();
      } else {
        setSetupStep("awaiting_approval");
      }
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : t("unknownError"));
      setSetupStep("idle");
    }
  };

  const handleCompleteLCLSetup = async () => {
    setSetupStep("completing");
    setSetupError(null);
    try {
      await completeLCLSetup();
      setSetupStep("idle");
      handleSync();
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : t("unknownError"));
      setSetupStep("awaiting_approval");
    }
  };

  return (
    <div className="py-3">
      {/* Main row - stacks on mobile (flex-col) instead of staying side by
          side: with a warning label like "Re-authentification requise" plus
          both a "Connecter" and a "Synchroniser" button on the right, the
          action cluster had nowhere to shrink into and overflowed past the
          card edge on narrow viewports. Same flex-col/sm:flex-row pattern
          already used for the institution rows just below on this page. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {log ? <StatusIcon status={log.status} /> : <Clock size={14} className="text-[var(--muted)]" aria-hidden="true" />}
          <div>
            <p className="text-sm font-medium text-[var(--foreground)]">{label}</p>
            <div aria-live="polite">
              {log ? (
                <p className="text-xs text-[var(--muted)]">
                  {needsReconnection(log.status) ? (
                    <span className="text-[var(--warning)]">{t("reAuthRequired")}</span>
                  ) : log.status === "success" ? (
                    <span>{timeAgo(log.createdAt, locale)}</span>
                  ) : (
                    <span className="text-[var(--negative)]">{log.message ?? t("error")}</span>
                  )}
                </p>
              ) : (
                <p className="text-xs text-[var(--muted)]">{t("neverSynced")}</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isAuthRequired && setupStep === "idle" && (
            <Button
              variant="outline"
              size="sm"
              onClick={source === "trade-republic" ? handleStartTRSetup : handleStartLCLSetup}
              className="border-[var(--warning)]/40 text-[var(--warning)] hover:bg-[var(--warning)]/10"
            >
              <LogIn size={12} aria-hidden="true" />
              {t("connect")}
            </Button>
          )}
          {setupStep === "starting" && (
            <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
              <RefreshCw size={12} className="animate-spin" aria-hidden="true" />
              {t("connecting")}
            </span>
          )}
          {!inSetupFlow && (
            <Button variant="outline" size="sm" onClick={handleSync} disabled={pending}>
              <RefreshCw size={12} className={pending ? "animate-spin" : ""} aria-hidden="true" />
              {pending ? t("syncing") : t("synchronize")}
            </Button>
          )}
        </div>
      </div>

      {syncError && (
        <p role="alert" className="mt-2 ml-[26px] text-xs text-[var(--negative)]">
          {syncError}
        </p>
      )}

      {/* TR - code input */}
      {(setupStep === "awaiting_code" || setupStep === "submitting") && (
        <div className="mt-3 ml-[26px] p-3 rounded-lg bg-[var(--surface-elevated)] border border-[var(--warning)]/20">
          <p className="text-xs text-[var(--muted)] mb-2">{t("trCodeHint")}</p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && handleCompleteTRSetup()}
              placeholder="1234"
              disabled={setupStep === "submitting"}
              aria-label={t("trCodeAriaLabel")}
              className="w-20 text-center text-lg font-mono tracking-[0.4em] px-2 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
            />
            <Button size="sm" onClick={handleCompleteTRSetup} disabled={code.length !== 4 || setupStep === "submitting"}>
              {setupStep === "submitting" ? (
                <><RefreshCw size={12} className="animate-spin" aria-hidden="true" /> {t("validating")}</>
              ) : (
                t("confirm")
              )}
            </Button>
            <Button variant="ghost" size="sm" onClick={reset}>
              {tc("cancel")}
            </Button>
          </div>
          {setupError && <p role="alert" className="mt-2 text-xs text-[var(--negative)]">{setupError}</p>}
        </div>
      )}

      {/* LCL - Certicode Plus approval */}
      {(setupStep === "awaiting_approval" || setupStep === "completing") && (
        <div className="mt-3 ml-[26px] p-3 rounded-lg bg-[var(--surface-elevated)] border border-[var(--warning)]/20">
          <p className="text-xs text-[var(--muted)] mb-3">
            {t.rich("lclApprovalHint", {
              // See configure-woob-dialog.tsx: a next-intl t.rich() renderer
              // callback, not a React component subject to the
              // remount/state-loss risk this rule targets.
              strong: (chunks) => <strong className="text-[var(--foreground)]">{chunks}</strong>, // NOSONAR (typescript:S6478)
            })}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleCompleteLCLSetup} disabled={setupStep === "completing"}>
              {setupStep === "completing" ? (
                <><RefreshCw size={12} className="animate-spin" aria-hidden="true" /> {t("validating")}</>
              ) : (
                t("lclConfirm")
              )}
            </Button>
            <Button variant="ghost" size="sm" onClick={reset}>
              {tc("cancel")}
            </Button>
          </div>
          {setupError && <p role="alert" className="mt-2 text-xs text-[var(--negative)]">{setupError}</p>}
        </div>
      )}
    </div>
  );
}
