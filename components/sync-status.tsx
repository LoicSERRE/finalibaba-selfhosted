"use client";

import { useState, useTransition } from "react";
import { RefreshCw, CheckCircle, AlertTriangle, Clock, LogIn } from "lucide-react";
import { triggerSync, startTRSetup, completeTRSetup, startLCLSetup, completeLCLSetup } from "@/lib/actions/sync";
import { useRouter } from "next/navigation";

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
  if (status === "success") return <CheckCircle size={14} className="text-[var(--positive)]" />;
  if (status === "auth_required") return <AlertTriangle size={14} className="text-amber-400" />;
  return <AlertTriangle size={14} className="text-[var(--negative)]" />;
}

function timeAgo(date: Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 0) return `il y a ${h}h`;
  if (m > 0) return `il y a ${m}min`;
  return "à l'instant";
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
      setSetupError(e instanceof Error ? e.message : "Erreur inconnue");
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
      setSetupError(e instanceof Error ? e.message : "Erreur inconnue");
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
      setSetupError(e instanceof Error ? e.message : "Erreur inconnue");
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
      setSetupError(e instanceof Error ? e.message : "Erreur inconnue");
      setSetupStep("awaiting_approval");
    }
  };

  return (
    <div className="py-3">
      {/* Main row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {log ? <StatusIcon status={log.status} /> : <Clock size={14} className="text-[var(--muted)]" />}
          <div>
            <p className="text-sm font-medium text-[var(--foreground)]">{label}</p>
            {log ? (
              <p className="text-xs text-[var(--muted)]">
                {log.status === "auth_required" ? (
                  <span className="text-amber-400">Re-authentification requise</span>
                ) : log.status === "success" ? (
                  <span>{timeAgo(log.createdAt)}</span>
                ) : (
                  <span className="text-[var(--negative)]">{log.message ?? "Erreur"}</span>
                )}
              </p>
            ) : (
              <p className="text-xs text-[var(--muted)]">Jamais synchronisé</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isAuthRequired && setupStep === "idle" && (
            <button
              onClick={source === "trade-republic" ? handleStartTRSetup : handleStartLCLSetup}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-amber-400/40 text-amber-400 hover:bg-amber-400/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
            >
              <LogIn size={12} />
              Connecter
            </button>
          )}
          {setupStep === "starting" && (
            <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
              <RefreshCw size={12} className="animate-spin" />
              Connexion… (10-30s)
            </span>
          )}
          {!inSetupFlow && (
            <button
              onClick={handleSync}
              disabled={pending}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--accent)] transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
            >
              <RefreshCw size={12} className={pending ? "animate-spin" : ""} />
              {pending ? "Sync en cours…" : "Synchroniser"}
            </button>
          )}
        </div>
      </div>

      {/* TR — code input */}
      {(setupStep === "awaiting_code" || setupStep === "submitting") && (
        <div className="mt-3 ml-[26px] p-3 rounded-lg bg-[var(--surface-elevated)] border border-amber-400/20">
          <p className="text-xs text-[var(--muted)] mb-2">
            Ouvre l&apos;app Trade Republic → entre le code à 4 chiffres affiché :
          </p>
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
              aria-label="Code à 4 chiffres"
              className="w-20 text-center text-lg font-mono tracking-[0.4em] px-2 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
            />
            <button
              onClick={handleCompleteTRSetup}
              disabled={code.length !== 4 || setupStep === "submitting"}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-elevated)]"
            >
              {setupStep === "submitting" ? (
                <><RefreshCw size={12} className="animate-spin" /> Validation…</>
              ) : (
                "Confirmer"
              )}
            </button>
            <button onClick={reset} className="min-h-[44px] px-2 text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors focus-visible:outline-none focus-visible:underline">
              Annuler
            </button>
          </div>
          {setupError && <p role="alert" className="mt-2 text-xs text-[var(--negative)]">{setupError}</p>}
        </div>
      )}

      {/* LCL — Certicode Plus approval */}
      {(setupStep === "awaiting_approval" || setupStep === "completing") && (
        <div className="mt-3 ml-[26px] p-3 rounded-lg bg-[var(--surface-elevated)] border border-amber-400/20">
          <p className="text-xs text-[var(--muted)] mb-3">
            Ouvre l&apos;app <strong className="text-[var(--foreground)]">LCL</strong> → <strong className="text-[var(--foreground)]">Certicode Plus</strong> → approuve la connexion, puis clique ci-dessous :
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCompleteLCLSetup}
              disabled={setupStep === "completing"}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-elevated)]"
            >
              {setupStep === "completing" ? (
                <><RefreshCw size={12} className="animate-spin" /> Validation…</>
              ) : (
                "J'ai approuvé dans l'app LCL"
              )}
            </button>
            <button onClick={reset} className="min-h-[44px] px-2 text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors focus-visible:outline-none focus-visible:underline">
              Annuler
            </button>
          </div>
          {setupError && <p role="alert" className="mt-2 text-xs text-[var(--negative)]">{setupError}</p>}
        </div>
      )}
    </div>
  );
}
