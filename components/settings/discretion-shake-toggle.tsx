"use client";

import { useState, useSyncExternalStore } from "react";
import { Smartphone } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  needsMotionPermission,
  requestMotionPermission,
  setShakePreference,
  shakeSupported,
  useMotionSeen,
  useShakePreference,
} from "@/components/layout/discretion-shake";
import { shakeShownOn } from "@/lib/domain/discretion";

const noSubscription = () => () => {};

/** Settings → Affichage: shake to hide, shown only on a phone or tablet. */
export function DiscretionShakeToggle() {
  const t = useTranslations("settings.discretion");
  const supported = useSyncExternalStore(noSubscription, shakeSupported, () => false);
  const preference = useShakePreference();
  const motionSeen = useMotionSeen();
  const [denied, setDenied] = useState(false);

  if (!supported || preference === null) return null;
  const checked = shakeShownOn(preference, needsMotionPermission(), motionSeen);

  // requestMotionPermission runs before the first await, still inside the
  // tap that iOS requires for its prompt.
  async function onChange(next: boolean) {
    setDenied(false);
    if (next && !(await requestMotionPermission())) {
      setDenied(true);
      return;
    }
    setShakePreference(next);
  }

  return (
    <div className="flex items-start gap-3">
      <input
        id="discretionShake"
        type="checkbox"
        checked={checked}
        onChange={(event) => void onChange(event.target.checked)}
        aria-describedby="discretionShakeHint"
        className="mt-0.5 accent-[var(--accent)]"
      />
      <div>
        <label
          htmlFor="discretionShake"
          className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)] cursor-pointer"
        >
          <Smartphone size={14} aria-hidden="true" />
          {t("shake")}
        </label>
        <span id="discretionShakeHint" className="block text-xs text-[var(--muted)] mt-0.5">
          {t("shakeHint")}
        </span>
        {denied && (
          <span role="alert" className="block text-xs text-[var(--negative)] mt-1">
            {t("shakeDenied")}
          </span>
        )}
      </div>
    </div>
  );
}
