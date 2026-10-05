import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

type Tone = "error" | "success" | "warning";

const TONE_CLASSES: Record<Tone, string> = {
  error: "border-[var(--negative)]/40 bg-[var(--negative)]/10 text-[var(--negative)]",
  success: "border-[var(--positive)]/40 bg-[var(--positive)]/10 text-[var(--positive)]",
  warning: "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]",
};

const TONE_ICONS: Record<Tone, typeof AlertTriangle> = {
  error: XCircle,
  success: CheckCircle2,
  warning: AlertTriangle,
};

/**
 * The one way a form says how an action went. Rendered next to the control
 * that caused it, not as a toast: the message stays until the next attempt,
 * which is what someone reading an error needs, and it needs no extra
 * dependency or global provider.
 *
 * An error is announced immediately (`role="alert"`); a success politely
 * (`role="status"`), so a screen reader does not interrupt for good news.
 * Renders nothing without a message, so a form can mount it unconditionally.
 */
export function FormAlert({
  tone,
  children,
  className = "",
}: Readonly<{ tone: Tone; children?: React.ReactNode; className?: string }>) {
  if (!children) return null;
  const Icon = TONE_ICONS[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${TONE_CLASSES[tone]} ${className}`}
    >
      <Icon size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
