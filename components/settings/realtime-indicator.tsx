import { Radio, RadioTower, ZapOff } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * Whether this Trade Republic connection is holding a live websocket.
 *
 * Real-time is the difference between a portfolio that moves on its own and
 * one that moves every four hours, and until now nothing said which you had.
 * A user who moved off the .env connection - what v2.1 invited them to do -
 * lost real-time silently, and reported it as "ça ne bouge pas": there was no
 * way, short of reading container logs, to tell a working listener from one
 * that was switched off, waiting on an expired session, or never started.
 *
 * A server component with no state of its own: the status is fetched once per
 * Settings render alongside the sync logs. `null` means the sync service did
 * not answer, in which case this renders nothing rather than guessing - the
 * service is optional and simply absent in local dev.
 */
export async function RealtimeIndicator({ state }: Readonly<{ state: string | undefined }>) {
  const t = await getTranslations("syncStatus");
  if (!state) return null;

  const variants: Record<string, { label: string; className: string; icon: typeof Radio }> = {
    listening: {
      label: t("realtimeListening"),
      className: "text-[var(--positive)]",
      icon: RadioTower,
    },
    stopped: {
      label: t("realtimeStopped"),
      className: "text-[var(--warning)]",
      icon: ZapOff,
    },
    disabled: {
      label: t("realtimeDisabled"),
      className: "text-[var(--muted)]",
      icon: ZapOff,
    },
    starting: {
      label: t("realtimeStarting"),
      className: "text-[var(--muted)]",
      icon: Radio,
    },
  };

  const variant = variants[state];
  if (!variant) return null;
  const Icon = variant.icon;

  return (
    <output className={`flex items-center gap-1 text-xs ${variant.className}`} title={variant.label}>
      <Icon size={12} aria-hidden="true" />
      <span className="sr-only sm:not-sr-only">{variant.label}</span>
    </output>
  );
}
