"use client";

import { useEffect, useState } from "react";
import { RefreshCw, LogIn, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
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
 * The ceremony lives in a dialog rather than inline in the institution row,
 * after a report that the code panel was "mal placé" and that confirming it
 * told you nothing. Both came from the same place: the row's right-hand
 * cluster is a `flex-wrap` sized to its buttons, so a panel rendered into it
 * was squeezed into whatever width happened to be left, and the flow had no
 * way to hold the screen once the panel closed - confirming the code reset
 * the component, put the "Connecter" button back, and left the sync running
 * invisibly until the row abruptly said it was synced.
 *
 * So the state machine below runs to completion in one place, including the
 * first sync. Reaching a synced account is the thing the user actually came
 * to do; treating the code as the finish line is what made the last step feel
 * like nothing was happening.
 *
 * Rendered by app/settings/page.tsx for an institution carrying trPhone,
 * exactly where WoobSetupPrompt is rendered for one carrying woobModule.
 */

type Step =
  | { name: "idle" }
  | { name: "requesting" }
  | { name: "code"; secondsLeft: number | null }
  | { name: "validating" }
  | { name: "syncing" }
  | { name: "done" };

export function TradeRepublicSetupPrompt({
  institutionId,
  log,
}: Readonly<{ institutionId: string; log: SyncLog | null }>) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ name: "idle" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const t = useTranslations("syncStatus");
  const tc = useTranslations("common");

  const secondsLeft = step.name === "code" ? step.secondsLeft : null;

  // One interval for the whole countdown, cleared on unmount and whenever the
  // flow moves on - not a timeout re-armed per tick, which would leak one timer
  // per second if the user navigated away mid-setup.
  useEffect(() => {
    if (secondsLeft === null || secondsLeft <= 0) return;
    const id = setInterval(() => {
      setStep((s) =>
        s.name === "code" && s.secondsLeft !== null
          ? { name: "code", secondsLeft: Math.max(0, s.secondsLeft - 1) }
          : s
      );
    }, 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  // Rendered as soon as the institution is configured, not only after a sync
  // has already failed. Trade Republic ALWAYS needs its pushed-code ceremony
  // before any sync can work, so a freshly configured institution has no
  // SyncLog at all and the old `auth_required`-only gate hid this button
  // exactly when it was needed. The only way to reveal it was to click
  // "Synchroniser" and read the error - which is what a user hit in
  // production, reporting they could not connect a Trade Republic account
  // through the UI at all.
  //
  // Deliberately not applied to WoobSetupPrompt: a Woob bank's first sync can
  // legitimately succeed from login and password alone, so showing a connect
  // step up front there would invent a ceremony most banks do not have.
  // Trade Republic is the one that always does.
  const needsConnection = !log || log.status === "auth_required";
  if (!needsConnection && !open) return null;

  const reset = () => {
    setStep({ name: "idle" });
    setCode("");
    setError(null);
  };

  const closeDialog = (next: boolean) => {
    // A ceremony in flight owns the screen: closing mid-way would leave a
    // pushed code and a half-open session with nothing on screen about either.
    if (!next && (step.name === "requesting" || step.name === "validating" || step.name === "syncing")) return;
    setOpen(next);
    if (!next) reset();
  };

  const runSync = async () => {
    setStep({ name: "syncing" });
    const result = await triggerInstitutionSync(institutionId);
    if (!result.ok) {
      setError(result.error);
      setStep({ name: "idle" });
      router.refresh();
      return;
    }
    setStep({ name: "done" });
    router.refresh();
  };

  const handleStart = async () => {
    setStep({ name: "requesting" });
    setError(null);
    setCode("");
    try {
      const result = await startInstitutionSetup(institutionId);
      // The sync service refused or was unreachable. A value rather than a
      // thrown error, because production redacts the latter - which is why a
      // real report was a bare 500 with no explanation anywhere.
      if (result.status === "failed") {
        setError(result.error);
        setStep({ name: "idle" });
        return;
      }
      // A session that still resumes needs no code at all: the sync service
      // reports that instead of pushing a pointless notification.
      if (result.status === "already_connected") {
        await runSync();
        return;
      }
      setStep({
        name: "code",
        secondsLeft: result.status === "code_required" ? (result.countdown ?? null) : null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unknownError"));
      setStep({ name: "idle" });
    }
  };

  const handleComplete = async () => {
    setStep({ name: "validating" });
    setError(null);
    try {
      const result = await completeInstitutionSetup(institutionId, code);
      if (!result.ok) {
        setError(result.error);
        setStep({ name: "code", secondsLeft });
        return;
      }
      await runSync();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unknownError"));
      setStep({ name: "code", secondsLeft });
    }
  };

  const expired = secondsLeft !== null && secondsLeft <= 0;

  return (
    <Dialog
      open={open}
      onOpenChange={closeDialog}
      title={t("trDialogTitle")}
      description={t("trCodeHint")}
      trigger={
        <Button
          variant="outline"
          size="sm"
          className="border-[var(--warning)]/40 text-[var(--warning)] hover:bg-[var(--warning)]/10"
        >
          <LogIn size={12} aria-hidden="true" />
          {t("connect")}
        </Button>
      }
    >
      <div className="space-y-4">
        <TradeRepublicSteps step={step} />

        {step.name === "idle" && (
          <>
            <p className="text-sm text-[var(--muted)]">{t("trStartHint")}</p>
            <Button onClick={handleStart} className="w-full">
              <LogIn size={14} aria-hidden="true" />
              {t("trStartAction")}
            </Button>
          </>
        )}

        {step.name === "requesting" && <Waiting label={t("trRequesting")} />}

        {step.name === "code" && (
          <div className="space-y-3">
            <p className="text-sm text-[var(--foreground)]">{t("trCodeHint")}</p>
            {secondsLeft !== null && (
              <p className={`text-xs ${expired ? "text-[var(--negative)]" : "text-[var(--muted)]"}`}>
                {expired ? t("trCodeExpired") : t("trCodeCountdown", { seconds: secondsLeft })}
              </p>
            )}
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && code.trim() && !expired && handleComplete()}
              aria-label={t("trCodeAriaLabel")}
              className="w-full text-center text-2xl font-mono tracking-[0.4em] px-3 py-2.5 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
            />
            {expired ? (
              <Button onClick={handleStart} className="w-full">
                {t("trResend")}
              </Button>
            ) : (
              <Button onClick={handleComplete} disabled={!code.trim()} className="w-full">
                {t("confirm")}
              </Button>
            )}
          </div>
        )}

        {step.name === "validating" && <Waiting label={t("validating")} />}
        {step.name === "syncing" && <Waiting label={t("trSyncing")} />}

        {step.name === "done" && (
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-sm text-[var(--positive)]">
              <CheckCircle2 size={16} aria-hidden="true" />
              {t("trConnected")}
            </p>
            <Button variant="outline" onClick={() => closeDialog(false)} className="w-full">
              {tc("close")}
            </Button>
          </div>
        )}

        {error && (
          <p role="alert" className="text-xs text-[var(--negative)]">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** A spinner with a sentence, not a spinner alone - every wait in this flow
 *  is a different one, and "it is doing something" is only half the answer. */
function Waiting({ label }: Readonly<{ label: string }>) {
  return (
    <output className="flex items-center gap-2 py-2 text-sm text-[var(--muted)]">
      <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
      {label}
    </output>
  );
}

const STEP_ORDER = ["request", "code", "sync"] as const;

/** Which of the three stages the ceremony is on, so the wait has a shape:
 *  the last one used to happen entirely off-screen. */
function TradeRepublicSteps({ step }: Readonly<{ step: Step }>) {
  const t = useTranslations("syncStatus");
  const currentIndex = {
    idle: 0,
    requesting: 0,
    code: 1,
    validating: 1,
    syncing: 2,
    done: 3,
  }[step.name];

  const labels = {
    request: t("trStepRequest"),
    code: t("trStepCode"),
    sync: t("trStepSync"),
  };

  return (
    <ol className="flex items-center gap-2 text-xs">
      {STEP_ORDER.map((name, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <li key={name} className="flex items-center gap-2">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium ${
                done
                  ? "border-[var(--positive)] bg-[var(--positive)]/15 text-[var(--positive)]"
                  : active
                    ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent-text)]"
                    : "border-[var(--border)] text-[var(--muted)]"
              }`}
              aria-hidden="true"
            >
              {done ? "✓" : index + 1}
            </span>
            <span className={active ? "text-[var(--foreground)]" : "text-[var(--muted)]"}>
              {labels[name]}
            </span>
            {index < STEP_ORDER.length - 1 && (
              <span className="h-px w-3 bg-[var(--border)]" aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
