/**
 * Whether app-lock applies to THIS browser. The account flag is one flag, but a
 * credential belongs to one device - gating on the flag alone locked a phone
 * that had no credential to unlock with, and Settings sits behind that lock.
 *
 * A plain localStorage marker, not something the server vouches for: app-lock
 * is explicitly not a security boundary, and the unlock state it guards already
 * lives in sessionStorage. Namespaced per user, so on a shared browser one
 * account's registration does not lock another's session.
 */
const KEY_PREFIX = "finalibaba-applock-device:";

export function appLockDeviceKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

/** Every access is guarded: a private window, cleared site data or a browser
 *  set to block storage can each make these throw rather than return null. */
export function isAppLockDevice(userId: string): boolean {
  try {
    return localStorage.getItem(appLockDeviceKey(userId)) === "1";
  } catch {
    // Unknowable, so do not lock: a browser that cannot remember registering
    // cannot have registered, and locking it would recreate the dead end.
    return false;
  }
}

export function markAppLockDevice(userId: string): void {
  try {
    localStorage.setItem(appLockDeviceKey(userId), "1");
  } catch {
    // The device just registered an authenticator and will still be able to
    // unlock; it simply will not be asked to on the next visit.
  }
}

export function forgetAppLockDevice(userId: string): void {
  try {
    localStorage.removeItem(appLockDeviceKey(userId));
  } catch {
    // Nothing to do: the marker is a convenience, not a record of truth.
  }
}

/**
 * How long the app may sit in the background before locking again. Without it
 * the unlock lasted the whole browser session, and an installed PWA is resumed
 * far more often than cold-started, so it practically never asked - a
 * decorative lock. Two minutes covers "walked away" without catching
 * "switched apps to copy an IBAN".
 */
export const RELOCK_AFTER_MS = 2 * 60 * 1000;

/** True when a stretch spent hidden is long enough to lock again. */
export function shouldRelock(hiddenSinceMs: number | null, nowMs: number): boolean {
  if (hiddenSinceMs === null) return false;
  return nowMs - hiddenSinceMs >= RELOCK_AFTER_MS;
}
