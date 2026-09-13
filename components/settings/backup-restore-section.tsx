"use client";

import { useRef, useState } from "react";
import { Download, Upload, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useTranslations } from "next-intl";

async function waitForRestart() {
  // The server exits after a successful restore so the container restart
  // policy hands the process a fresh DB connection pool - poll a cheap
  // page (never /api/backup - that would trigger another full pg_dump)
  // until it responds again, instead of reloading straight into a
  // connection-refused error.
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      await fetch(window.location.pathname, { method: "HEAD", cache: "no-store" });
      break;
    } catch {
      // still restarting
    }
  }
  window.location.reload();
}

export function BackupRestoreSection() {
  const t = useTranslations("settings.backup");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One passphrase field per direction rather than a shared one: they are
  // different acts, and a value left over from a download is not what anyone
  // means to type into a restore.
  const [downloadPass, setDownloadPass] = useState("");
  const [restorePass, setRestorePass] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setError(null);
    setRestorePass("");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleRestore() {
    if (!file) return;
    setPending(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("passphrase", restorePass);
      const res = await fetch("/api/backup", { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? t("restoreError"));
      }
      setRestarting(true);
      await waitForRestart();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("restoreError"));
      setPending(false);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-[var(--foreground)]">{t("title")}</h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">{t("subtitle")}</p>
      </div>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 flex flex-wrap gap-3">
        {/* Not a Next.js page - /api/backup streams a gzip DB dump for the
            browser to download, so a real navigation (not the client
            router) is required for its Content-Disposition header to take
            effect. */}
        <div className="flex flex-col gap-2 w-full sm:w-auto">
          <div className="flex flex-wrap items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-location-assign-relative-destination */}
            <Button
              variant="outline"
              onClick={() => {
                // A real navigation, not the client router: Content-Disposition
                // only takes effect on one.
                const query = downloadPass ? `?passphrase=${encodeURIComponent(downloadPass)}` : "";
                window.location.href = `/api/backup${query}`;
              }}
            >
              <Download size={14} aria-hidden="true" />
              {t("download")}
            </Button>
            <input
              type="password"
              value={downloadPass}
              onChange={(e) => setDownloadPass(e.target.value)}
              placeholder={t("passphrasePlaceholder")}
              autoComplete="new-password"
              aria-label={t("passphraseLabel")}
              className="flex-1 min-w-[12rem] bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30"
            />
          </div>
          <p className="text-xs text-[var(--muted)] max-w-md">{t("passphraseHint")}</p>
        </div>

        <Dialog
          open={open}
          onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}
          title={t("restoreTitle")}
          trigger={
            <Button variant="outline">
              <Upload size={14} aria-hidden="true" />
              {t("restore")}
            </Button>
          }
        >
          <div className="space-y-4">
            {restarting ? (
              <p className="text-sm text-[var(--foreground)]">{t("restarting")}</p>
            ) : (
              <>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--negative)]/10 border border-[var(--negative)]/20">
              <AlertTriangle size={16} className="text-[var(--negative)] shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-sm text-[var(--foreground)]">{t("restoreWarning")}</p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="restore-file" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                {t("restoreFile")}
              </label>
              <input
                id="restore-file"
                ref={inputRef}
                type="file"
                accept=".sql,.gz,.enc,application/sql,application/gzip,application/octet-stream"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-[var(--foreground)] file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[var(--surface-elevated)] file:text-[var(--foreground)] file:cursor-pointer cursor-pointer"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="restore-pass" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                {t("passphraseLabel")}
              </label>
              <input
                id="restore-pass"
                type="password"
                value={restorePass}
                onChange={(e) => setRestorePass(e.target.value)}
                autoComplete="new-password"
                placeholder={t("passphraseOptional")}
                className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30"
              />
              <p className="text-xs text-[var(--muted)]">{t("passphraseRestoreHint")}</p>
            </div>

            {error && <p className="text-sm text-[var(--negative)]">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {tc("cancel")}
              </Button>
              <Button variant="destructive" onClick={handleRestore} disabled={!file || pending}>
                <Upload size={14} aria-hidden="true" />
                {pending ? t("restoring") : t("restoreConfirm")}
              </Button>
            </div>
              </>
            )}
          </div>
        </Dialog>
      </div>
    </section>
  );
}
