"use client";

import { useState, useTransition } from "react";
import { RefreshCw, CheckCircle, AlertTriangle, Clock, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { triggerSync, startTRSetup, completeTRSetup, startLCLSetup, completeLCLSetup } from "@/lib/actions/sync";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

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

function StatusIcon({ status }: { status: string }) {
  if (status === "success") return <CheckCircle size={14} className="text-[var(--positive)]" aria-hidden="true" />;
  if (status === "auth_required") return <AlertTriangle size={14} className="text-[var(--warning)]" aria-hidden="true" />;
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

export function SyncStatus({ source, label, log }: Props) {
  const [pending, startTransition] = useTransition();
  const [setupStep, setSetupStep] = useState<SetupStep>("idle");
  const [code, setCode] = useState("");
  const [setupError, setSetupError] = useState<string | null>(null);
  const router = useRouter();
  const t = useTranslations("syncStatus");
  const tc = useTranslations("common");
  const locale = useLocale();

  const isAuthRequired = log?.status === "auth_required";
  const inSetupFlow = setupStep !== "idle";

  const reset = () => { setSetupStep("idle"); setCode(""); setSetupError(null); };

  const handleSync = () => {
    startTransition(async () => {
      await triggerSync(source);
      router.refresh();
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
      {/* Main row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {log ? <StatusIcon status={log.status} /> : <Clock size={14} className="text-[var(--muted)]" aria-hidden="true" />}
          <div>
            <p className="text-sm font-medium text-[var(--foreground)]">{label}</p>
            <div aria-live="polite">
              {log ? (
                <p className="text-xs text-[var(--muted)]">
                  {log.status === "auth_required" ? (
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

        <div className="flex items-center gap-2">
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
              strong: (chunks) => <strong className="text-[var(--foreground)]">{chunks}</strong>,
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
