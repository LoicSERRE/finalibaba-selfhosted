"use client";

import { useEffect, useState } from "react";
import { Lock, RefreshCw, AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import {
  startAppLockAuthentication,
  verifyAppLockAuthentication,
  startAppLockRegistration,
  verifyAppLockRegistration,
} from "@/lib/actions/app-lock";
import { isAppLockDevice, markAppLockDevice } from "@/lib/domain/app-lock-device";

// Namespaced per user (v2.0) - a shared browser where two accounts both use
// app-lock must not let one user's unlock satisfy the other's lock screen.
const sessionKeyFor = (userId: string) => `finalibaba-applock-unlocked:${userId}`;

// A fast LOCAL unlock layer for an already-installed, already-trusted PWA -
// deliberately not a network/security boundary the way AUTH_ENABLED's
// server-side NextAuth session is (see CLAUDE.md's "Authentication"). The
// server still renders and sends the real page content in the initial RSC
// payload regardless of lock state (Next has no server-side concept of
// "this browser tab is currently locked") - this component only hides it
// behind a full-screen overlay client-side until a WebAuthn ceremony
// succeeds. That's an intentional, proportionate match to the actual ask
// (Finary/Trade Republic's own app-lock works the same way: a local UI
// gate in front of data the app already has cached, not a re-fetch-behind-
// auth boundary) - it protects against "someone picks up my unlocked
// phone", not network interception (TLS/the reverse proxy's job) or local
// devtools access (which could trivially clear sessionStorage anyway, the
// same way it could bypass a native app's keychain-backed lock only with
// far more effort).
//
// Unlock state lives in sessionStorage, not a cookie: it should re-lock
// when the browser/PWA is fully closed and reopened, not persist like a
// login session - the point is a per-open unlock, not a second sign-in.
export function AppLockGate({
  enabled,
  userId,
  children,
}: Readonly<{ enabled: boolean; userId: string; children: React.ReactNode }>) {
  const sessionKey = sessionKeyFor(userId);
  const t = useTranslations("appLock");
  const [unlocked, setUnlocked] = useState(!enabled);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [canRegister, setCanRegister] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    // The lock is per device. A browser that never registered an
    // authenticator has nothing to unlock with, and Settings - where it would
    // register one - sits behind this very screen. Locking it is a dead end,
    // which is exactly what a user hit: app-lock on the laptop locked the
    // phone out of the app entirely. See lib/domain/app-lock-device.ts.
    if (!isAppLockDevice(userId)) {
      setUnlocked(true);
      return;
    }
    if (sessionStorage.getItem(sessionKey) === "1") {
      setUnlocked(true);
      return;
    }
    if (!browserSupportsWebAuthn()) setUnsupported(true);
    // Deliberately no auto-triggered ceremony on mount - forcing a native
    // biometric prompt the instant the page loads (before the user has
    // even seen why) is jarring; a visible "Unlock" button makes the
    // prompt an expected response to a real tap, not a surprise.
  }, [enabled, sessionKey, userId]);

  async function handleUnlock() {
    setChecking(true);
    setError(null);
    try {
      const optionsJSON = await startAppLockAuthentication();
      const response = await startAuthentication({ optionsJSON });
      await verifyAppLockAuthentication(response);
      sessionStorage.setItem(sessionKey, "1");
      setUnlocked(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unknownError"));
      // The credential this browser registered may have been revoked from
      // another device, or its authenticator reset. Without a way back it
      // would be locked out for good, so offer to register it again - which
      // is no weaker than the lock itself, since reaching this screen already
      // required whatever authentication the instance is configured with.
      setCanRegister(true);
    } finally {
      setChecking(false);
    }
  }

  async function handleRegisterThisDevice() {
    setChecking(true);
    setError(null);
    try {
      const optionsJSON = await startAppLockRegistration();
      const response = await startRegistration({ optionsJSON });
      await verifyAppLockRegistration(response, t("thisDevice"));
      markAppLockDevice(userId);
      sessionStorage.setItem(sessionKey, "1");
      setUnlocked(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unknownError"));
    } finally {
      setChecking(false);
    }
  }

  if (unlocked) return <>{children}</>;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[var(--background)] p-6">
      <div className="max-w-sm w-full text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-[var(--surface-elevated)] flex items-center justify-center">
          <Lock size={20} className="text-[var(--accent)]" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-[var(--foreground)]">{t("lockTitle")}</h1>
          <p className="text-sm text-[var(--muted)] mt-1">{t("lockSubtitle")}</p>
        </div>
        {unsupported ? (
          <p className="text-sm text-[var(--negative)] flex items-center justify-center gap-2">
            <AlertTriangle size={14} aria-hidden="true" />
            {t("unsupported")}
          </p>
        ) : (
          <div className="space-y-2">
            <Button onClick={handleUnlock} disabled={checking} className="w-full justify-center">
              {checking ? (
                <>
                  <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
                  {t("unlocking")}
                </>
              ) : (
                t("unlockButton")
              )}
            </Button>
            {error && <p role="alert" className="text-xs text-[var(--negative)]">{error}</p>}
            {canRegister && (
              <>
                <p className="text-xs text-[var(--muted)]">{t("registerAgainHint")}</p>
                <Button
                  variant="outline"
                  onClick={handleRegisterThisDevice}
                  disabled={checking}
                  className="w-full justify-center"
                >
                  {t("registerAgain")}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
