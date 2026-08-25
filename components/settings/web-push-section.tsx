"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, Plus, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { EmptyState } from "@/components/shared/empty-state";
import { subscribeToPush, unsubscribeFromPush, updateWebPushEnabled } from "@/lib/actions/push";

type Subscription = {
  id: string;
  deviceLabel: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
};

// Standard base64url -> Uint8Array conversion for a VAPID public key -
// PushManager.subscribe's applicationServerKey wants raw bytes, not the
// base64url string web-push's generateVAPIDKeys() and this component's own
// publicKey prop both use everywhere else.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replaceAll("-", "+").replaceAll("_", "/");
  const raw = atob(base64Safe);
  // codePointAt, not charCodeAt - every character here is a single-byte
  // base64 alphabet character from atob's own output, so the two are
  // equivalent in practice; the `?? 0` fallback is never actually hit,
  // just satisfying codePointAt's wider (number | undefined) return type.
  return Uint8Array.from(raw, (c) => c.codePointAt(0) ?? 0);
}

export function WebPushSection({
  enabled,
  publicKey,
  subscriptions,
}: Readonly<{ enabled: boolean; publicKey: string; subscriptions: Subscription[] }>) {
  const t = useTranslations("settings.webPush");
  const tc = useTranslations("common");
  const router = useRouter();
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setSupported("serviceWorker" in navigator && "PushManager" in window);
  }, []);

  const [addOpen, setAddOpen] = useState(false);
  const [deviceLabel, setDeviceLabel] = useState("");
  const [subscribing, setSubscribing] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function handleSubscribe() {
    setSubscribing(true);
    setAddError(null);
    try {
      if (Notification.permission === "default") {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") throw new Error(t("permissionDenied"));
      } else if (Notification.permission === "denied") {
        throw new Error(t("permissionDenied"));
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast needed: TS's DOM lib types applicationServerKey against a
        // plain ArrayBuffer-backed BufferSource, but Uint8Array.from()'s
        // inferred generic is the wider ArrayBufferLike (which also covers
        // SharedArrayBuffer) - a real byte array either way, just a type
        // mismatch between two DOM lib generations, not a runtime concern.
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      await subscribeToPush(subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }, deviceLabel);
      setAddOpen(false);
      setDeviceLabel("");
      router.refresh();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : t("unknownError"));
    } finally {
      setSubscribing(false);
    }
  }

  async function handleRemove(id: string) {
    await unsubscribeFromPush(id);
    router.refresh();
  }

  async function handleDisable() {
    await updateWebPushEnabled(false);
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
                <label htmlFor="push-device-label" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                  {t("deviceLabelField")}
                </label>
                <input
                  id="push-device-label"
                  type="text"
                  value={deviceLabel}
                  onChange={(e) => setDeviceLabel(e.target.value)}
                  placeholder={t("deviceLabelPlaceholder")}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              {addError && <p role="alert" className="text-xs text-[var(--negative)]">{addError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setAddOpen(false)} disabled={subscribing}>
                  {tc("cancel")}
                </Button>
                <Button onClick={handleSubscribe} disabled={subscribing}>
                  {subscribing ? (
                    <>
                      <RefreshCw size={12} className="animate-spin" aria-hidden="true" />
                      {t("subscribing")}
                    </>
                  ) : (
                    t("subscribe")
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
              <Bell size={16} className="text-[var(--positive)]" aria-hidden="true" />
              <span className="text-sm text-[var(--foreground)]">{t("enabledStatus")}</span>
            </>
          ) : (
            <>
              <BellOff size={16} className="text-[var(--muted)]" aria-hidden="true" />
              <span className="text-sm text-[var(--muted)]">{t("disabledStatus")}</span>
            </>
          )}
        </div>
        {enabled && (
          <Button variant="destructive" size="sm" onClick={handleDisable}>
            <BellOff size={14} aria-hidden="true" />
            {t("disable")}
          </Button>
        )}
      </div>

      {subscriptions.length === 0 ? (
        <EmptyState icon={Bell} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
          {subscriptions.map((sub) => (
            <div key={sub.id} className="px-5 py-3.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">{sub.deviceLabel || t("unlabeled")}</p>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  {t("registeredOn", { date: sub.createdAt.toLocaleDateString() })}
                  {" · "}
                  {sub.lastUsedAt ? t("lastUsedOn", { date: sub.lastUsedAt.toLocaleDateString() }) : t("neverUsed")}
                </p>
              </div>
              <DeleteButton
                label={t("remove")}
                description={t("removeDescription")}
                onDelete={handleRemove.bind(null, sub.id)}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
