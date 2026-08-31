"use client";

import { useState } from "react";
import { ShieldCheck, ShieldOff, RefreshCw, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { startTotpSetup, confirmTotpSetup, disableTotp, regenerateBackupCodes } from "@/lib/actions/totp";

type EnableStep = "idle" | "starting" | "awaiting_confirmation" | "confirming" | "showing_backup_codes";
type CodeStep = "idle" | "awaiting_code" | "submitting" | "showing_backup_codes";

function BackupCodesGrid({ codes }: Readonly<{ codes: string[] }>) {
  return (
    <div className="grid grid-cols-2 gap-2 p-3 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] font-mono text-sm">
      {codes.map((c) => (
        <span key={c} className="text-[var(--foreground)]">{c}</span>
      ))}
    </div>
  );
}

// A returned failure carries a stable key, not a sentence: a thrown Server
// Action error is replaced by an opaque digest in production, so the reason
// had to become part of the result rather than the exception. See
// lib/actions/totp.ts.
const FAILURE_KEYS = {
  invalid_code: "errorInvalidCode",
  not_enabled: "errorNotEnabled",
  no_pending_setup: "errorNoPendingSetup",
} as const;

export function TwoFactorSection({ totpEnabled }: Readonly<{ totpEnabled: boolean }>) {
  const t = useTranslations("settings.twoFactor");
  const tc = useTranslations("common");
  const router = useRouter();

  // ── Enable flow ──────────────────────────────────────────────────────────────
  const [enableOpen, setEnableOpen] = useState(false);
  const [enableStep, setEnableStep] = useState<EnableStep>("idle");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [enableError, setEnableError] = useState<string | null>(null);

  function resetEnable() {
    setEnableStep("idle");
    setQrDataUrl("");
    setSecret("");
    setConfirmCode("");
    setBackupCodes([]);
    setEnableError(null);
  }

  async function handleStartEnable() {
    setEnableStep("starting");
    setEnableError(null);
    try {
      const result = await startTotpSetup();
      setQrDataUrl(result.qrDataUrl);
      setSecret(result.secret);
      setEnableStep("awaiting_confirmation");
    } catch (e) {
      setEnableError(e instanceof Error ? e.message : t("unknownError"));
      setEnableStep("idle");
    }
  }

  async function handleConfirmEnable() {
    setEnableStep("confirming");
    setEnableError(null);
    try {
      const result = await confirmTotpSetup(confirmCode);
      if (!result.ok) {
        setEnableError(t(FAILURE_KEYS[result.error]));
        setEnableStep("awaiting_confirmation");
        return;
      }
      setBackupCodes(result.backupCodes);
      setEnableStep("showing_backup_codes");
    } catch (e) {
      setEnableError(e instanceof Error ? e.message : t("unknownError"));
      setEnableStep("awaiting_confirmation");
    }
  }

  function handleFinishEnable() {
    setEnableOpen(false);
    resetEnable();
    router.refresh();
  }

  // ── Disable flow ─────────────────────────────────────────────────────────────
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableStep, setDisableStep] = useState<CodeStep>("idle");
  const [disableCode, setDisableCode] = useState("");
  const [disableError, setDisableError] = useState<string | null>(null);

  function resetDisable() {
    setDisableStep("idle");
    setDisableCode("");
    setDisableError(null);
  }

  async function handleDisable() {
    setDisableStep("submitting");
    setDisableError(null);
    try {
      const result = await disableTotp(disableCode);
      if (!result.ok) {
        setDisableError(t(FAILURE_KEYS[result.error]));
        setDisableStep("awaiting_code");
        return;
      }
      setDisableOpen(false);
      resetDisable();
      router.refresh();
    } catch (e) {
      setDisableError(e instanceof Error ? e.message : t("unknownError"));
      setDisableStep("awaiting_code");
    }
  }

  // ── Regenerate backup codes flow ─────────────────────────────────────────────
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenStep, setRegenStep] = useState<CodeStep>("idle");
  const [regenCode, setRegenCode] = useState("");
  const [regenBackupCodes, setRegenBackupCodes] = useState<string[]>([]);
  const [regenError, setRegenError] = useState<string | null>(null);

  function resetRegen() {
    setRegenStep("idle");
    setRegenCode("");
    setRegenBackupCodes([]);
    setRegenError(null);
  }

  async function handleRegenerate() {
    setRegenStep("submitting");
    setRegenError(null);
    try {
      const result = await regenerateBackupCodes(regenCode);
      if (!result.ok) {
        setRegenError(t(FAILURE_KEYS[result.error]));
        setRegenStep("awaiting_code");
        return;
      }
      setRegenBackupCodes(result.backupCodes);
      setRegenStep("showing_backup_codes");
    } catch (e) {
      setRegenError(e instanceof Error ? e.message : t("unknownError"));
      setRegenStep("awaiting_code");
    }
  }

  function handleFinishRegen() {
    setRegenOpen(false);
    resetRegen();
    router.refresh();
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-[var(--foreground)]">{t("title")}</h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">{t("subtitle")}</p>
      </div>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {totpEnabled ? (
            <>
              <ShieldCheck size={16} className="text-[var(--positive)]" aria-hidden="true" />
              <span className="text-sm text-[var(--foreground)]">{t("enabledStatus")}</span>
            </>
          ) : (
            <>
              <ShieldOff size={16} className="text-[var(--muted)]" aria-hidden="true" />
              <span className="text-sm text-[var(--muted)]">{t("disabledStatus")}</span>
            </>
          )}
        </div>

        {totpEnabled ? (
          <div className="flex flex-wrap gap-2">
            {/* Regenerate backup codes */}
            <Dialog
              open={regenOpen}
              // Never dismissible while the new codes are on screen unacknowledged -
              // only the explicit Done button (handleFinishRegen) closes this dialog then.
              onOpenChange={(v) => {
                if (regenStep === "showing_backup_codes") return;
                setRegenOpen(v);
                if (!v) resetRegen();
              }}
              title={t("regenerateTitle")}
              trigger={
                <Button variant="outline" size="sm">
                  <RefreshCw size={14} aria-hidden="true" />
                  {t("regenerate")}
                </Button>
              }
            >
              {regenStep === "showing_backup_codes" ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--warning)]/10 border border-[var(--warning)]/20">
                    <AlertTriangle size={16} className="text-[var(--warning)] shrink-0 mt-0.5" aria-hidden="true" />
                    <p className="text-sm text-[var(--foreground)]">{t("backupCodesWarning")}</p>
                  </div>
                  <BackupCodesGrid codes={regenBackupCodes} />
                  <div className="flex justify-end pt-2">
                    <Button onClick={handleFinishRegen}>{t("backupCodesDone")}</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-[var(--muted)]">{t("regenerateHint")}</p>
                  <div className="space-y-1.5">
                    <label htmlFor="regen-code" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                      {t("codeLabel")}
                    </label>
                    <input
                      id="regen-code"
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={regenCode}
                      onChange={(e) => setRegenCode(e.target.value.replace(/\D/g, ""))}
                      placeholder="123456"
                      autoComplete="one-time-code"
                      className="w-full text-center text-lg font-mono tracking-[0.4em] px-2 py-1.5 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                  {regenError && <p role="alert" className="text-xs text-[var(--negative)]">{regenError}</p>}
                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="outline" onClick={() => setRegenOpen(false)} disabled={regenStep === "submitting"}>
                      {tc("cancel")}
                    </Button>
                    <Button onClick={handleRegenerate} disabled={regenCode.length !== 6 || regenStep === "submitting"}>
                      {regenStep === "submitting" ? (
                        <><RefreshCw size={12} className="animate-spin" aria-hidden="true" /> {t("validating")}</>
                      ) : (
                        t("confirm")
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </Dialog>

            {/* Disable */}
            <Dialog
              open={disableOpen}
              onOpenChange={(v) => { setDisableOpen(v); if (!v) resetDisable(); }}
              title={t("disableTitle")}
              trigger={
                <Button variant="destructive" size="sm">
                  <ShieldOff size={14} aria-hidden="true" />
                  {t("disable")}
                </Button>
              }
            >
              <div className="space-y-4">
                <p className="text-sm text-[var(--muted)]">{t("disableHint")}</p>
                <div className="space-y-1.5">
                  <label htmlFor="disable-code" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                    {t("codeLabel")}
                  </label>
                  <input
                    id="disable-code"
                    type="text"
                    autoComplete="one-time-code"
                    maxLength={11}
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value)}
                    placeholder="123456"
                    className="w-full text-center text-lg font-mono tracking-[0.2em] px-2 py-1.5 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
                {disableError && <p role="alert" className="text-xs text-[var(--negative)]">{disableError}</p>}
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setDisableOpen(false)} disabled={disableStep === "submitting"}>
                    {tc("cancel")}
                  </Button>
                  <Button variant="destructive" onClick={handleDisable} disabled={!disableCode || disableStep === "submitting"}>
                    {disableStep === "submitting" ? (
                      <><RefreshCw size={12} className="animate-spin" aria-hidden="true" /> {t("validating")}</>
                    ) : (
                      t("disableConfirm")
                    )}
                  </Button>
                </div>
              </div>
            </Dialog>
          </div>
        ) : (
          <Dialog
            open={enableOpen}
            onOpenChange={(v) => {
              if (enableStep === "showing_backup_codes") return;
              setEnableOpen(v);
              if (!v) resetEnable();
            }}
            title={t("enableTitle")}
            trigger={
              <Button variant="outline" size="sm">
                <ShieldCheck size={14} aria-hidden="true" />
                {t("enable")}
              </Button>
            }
          >
            {enableStep === "idle" && (
              <div className="space-y-4">
                <p className="text-sm text-[var(--muted)]">{t("enableHint")}</p>
                <div className="flex justify-end pt-2">
                  <Button onClick={handleStartEnable}>{t("start")}</Button>
                </div>
              </div>
            )}

            {enableStep === "starting" && (
              <p className="text-sm text-[var(--muted)] flex items-center gap-2">
                <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
                {t("generating")}
              </p>
            )}

            {(enableStep === "awaiting_confirmation" || enableStep === "confirming") && (
              <div className="space-y-4">
                <p className="text-sm text-[var(--muted)]">{t("scanQr")}</p>
                <div className="flex justify-center p-3 bg-white rounded-lg">
                  {/* Server-generated data: URI, not a remote image - no next/image benefit here */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrDataUrl} alt={t("qrAlt")} width={200} height={200} />
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs text-[var(--muted)]">{t("manualEntryHint")}</p>
                  <p className="font-mono text-xs text-[var(--foreground)] break-all p-2 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)]">
                    {secret}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="confirm-code" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                    {t("codeLabel")}
                  </label>
                  <input
                    id="confirm-code"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={confirmCode}
                    onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="123456"
                    autoComplete="one-time-code"
                    className="w-full text-center text-lg font-mono tracking-[0.4em] px-2 py-1.5 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
                {enableError && <p role="alert" className="text-xs text-[var(--negative)]">{enableError}</p>}
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setEnableOpen(false)} disabled={enableStep === "confirming"}>
                    {tc("cancel")}
                  </Button>
                  <Button onClick={handleConfirmEnable} disabled={confirmCode.length !== 6 || enableStep === "confirming"}>
                    {enableStep === "confirming" ? (
                      <><RefreshCw size={12} className="animate-spin" aria-hidden="true" /> {t("validating")}</>
                    ) : (
                      t("confirm")
                    )}
                  </Button>
                </div>
              </div>
            )}

            {enableStep === "showing_backup_codes" && (
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--warning)]/10 border border-[var(--warning)]/20">
                  <AlertTriangle size={16} className="text-[var(--warning)] shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="text-sm text-[var(--foreground)]">{t("backupCodesWarning")}</p>
                </div>
                <BackupCodesGrid codes={backupCodes} />
                <div className="flex justify-end pt-2">
                  <Button onClick={handleFinishEnable}>{t("backupCodesDone")}</Button>
                </div>
              </div>
            )}
          </Dialog>
        )}
      </div>
    </section>
  );
}
