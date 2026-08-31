"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, ShieldOff, Plus, RefreshCw, Smartphone } from "lucide-react";
import { formatDateShort, localeToIntl } from "@/lib/utils/format";
import { markAppLockDevice, forgetAppLockDevice } from "@/lib/domain/app-lock-device";
import { useLocale, useTranslations } from "next-intl";
import { startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { EmptyState } from "@/components/shared/empty-state";
import {
  startAppLockRegistration,
  verifyAppLockRegistration,
  removeAppLockCredential,
  disableAppLock,
} from "@/lib/actions/app-lock";

type Credential = {
  id: string;
  deviceLabel: string;
  createdAt: Date;
  lastUsedAt: Date | null;
};

export function AppLockSection({
  enabled,
  credentials,
  userId,
}: Readonly<{ enabled: boolean; credentials: Credential[]; userId: string }>) {
  const t = useTranslations("settings.appLock");
  const intlLocale = localeToIntl(useLocale());
  const tc = useTranslations("common");
  const router = useRouter();
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
  }, []);

  const [addOpen, setAddOpen] = useState(false);
  const [deviceLabel, setDeviceLabel] = useState("");
  const [registering, setRegistering] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function handleAdd() {
    setRegistering(true);
    setAddError(null);
    try {
      const optionsJSON = await startAppLockRegistration();
      const response = await startRegistration({ optionsJSON });
      await verifyAppLockRegistration(response, deviceLabel);
      // Marks THIS browser as one the lock screen applies to. Without it the
      // account flag would lock every device the user owns, including ones
      // with no credential to unlock with - see lib/domain/app-lock-device.ts.
      markAppLockDevice(userId);
      setAddOpen(false);
      setDeviceLabel("");
      router.refresh();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : t("unknownError"));
    } finally {
      setRegistering(false);
    }
  }

  async function handleRemove(id: string) {
    await removeAppLockCredential(id);
    router.refresh();
  }

  async function handleDisable() {
    await disableAppLock();
    // Turning it off account-wide should also stop this browser claiming to
    // be a registered one, or re-enabling later would lock it before it has
    // registered again.
    forgetAppLockDevice(userId);
    router.refresh();
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-2">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">{t("title")}</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">{t("subtitle")}</p>
        </div>
        {supported ? (
          <Dialog
            open={addOpen}
            onOpenChange={(v) => {
              setAddOpen(v);
              if (!v) {
                setDeviceLabel("");
                setAddError(null);
              }
            }}
            title={t("addTitle")}
            trigger={
              <Button variant="outline" size="sm">
                <Plus size={14} aria-hidden="true" />
                {t("addDevice")}
              </Button>
            }
          >
            <div className="space-y-4">
              <p className="text-sm text-[var(--muted)]">{t("addHint")}</p>
              <div className="space-y-1.5">
                <label htmlFor="applock-device-label" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                  {t("deviceLabelField")}
                </label>
                <input
                  id="applock-device-label"
                  type="text"
                  value={deviceLabel}
                  onChange={(e) => setDeviceLabel(e.target.value)}
                  placeholder={t("deviceLabelPlaceholder")}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              {addError && <p role="alert" className="text-xs text-[var(--negative)]">{addError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setAddOpen(false)} disabled={registering}>
                  {tc("cancel")}
                </Button>
                <Button onClick={handleAdd} disabled={registering}>
                  {registering ? (
                    <>
                      <RefreshCw size={12} className="animate-spin" aria-hidden="true" />
                      {t("registering")}
                    </>
                  ) : (
                    t("register")
                  )}
                </Button>
              </div>
            </div>
          </Dialog>
        ) : (
          <p className="text-xs text-[var(--negative)] max-w-xs text-right">{t("unsupported")}</p>
        )}
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {enabled ? (
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
        {enabled && (
          <Button variant="destructive" size="sm" onClick={handleDisable}>
            <ShieldOff size={14} aria-hidden="true" />
            {t("disable")}
          </Button>
        )}
      </div>

      {credentials.length === 0 ? (
        <EmptyState icon={Smartphone} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
          {credentials.map((cred) => (
            <div key={cred.id} className="px-5 py-3.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">{cred.deviceLabel}</p>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  {t("registeredOn", { date: formatDateShort(cred.createdAt, intlLocale) })}
                  {" · "}
                  {cred.lastUsedAt ? t("lastUsedOn", { date: formatDateShort(cred.lastUsedAt, intlLocale) }) : t("neverUsed")}
                </p>
              </div>
              <DeleteButton
                label={t("remove")}
                description={t("removeDescription")}
                onDelete={handleRemove.bind(null, cred.id)}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
