/**
 * Whether app-lock applies to *this* browser.
 *
 * `User.appLockEnabled` is one flag for the account, but an
 * `AppLockCredential` belongs to a single device: a phone's Face ID and a
 * laptop's Windows Hello are separate key pairs. Gating the lock screen on the
 * account flag alone produced a dead end, reported from a real instance:
 * enable app-lock on the laptop and the phone is locked too, with no
 * credential to unlock it and Settings sitting behind the very lock it would
 * need to register one.
 *
 * So the lock is per device, which is also how a native app-lock behaves - you
 * turn it on in the app, on that device. A browser that has registered an
 * authenticator carries this marker and gets the lock screen; one that has not
 * is simply not locked, and can reach Settings to register itself.
 *
 * The marker is deliberately a plain localStorage flag rather than anything
 * the server vouches for. App-lock is explicitly not a security boundary (see
 * components/layout/app-lock-gate.tsx): the unlock state it guards already
 * lives in sessionStorage, which the same devtools could clear just as easily.
 * This adds no weakness that was not already stated.
 *
 * Namespaced per user for the same reason the unlock flag is: on a shared
 * browser, one account's registration must not lock another's session.
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
 * How long the app may sit in the background before it locks again.
 *
 * Without this the unlock lasted for the whole browser session, so an
 * installed PWA that is resumed far more often than it is cold-started
 * practically never asked again - which makes the lock decorative. Two
 * minutes is the same order as a phone's own screen lock, and short enough
 * that "I put it down and walked away" is covered while "I switched apps to
 * copy an IBAN" is not.
 */
export const RELOCK_AFTER_MS = 2 * 60 * 1000;

/** True when a stretch spent hidden is long enough to lock again. */
export function shouldRelock(hiddenSinceMs: number | null, nowMs: number): boolean {
  if (hiddenSinceMs === null) return false;
  return nowMs - hiddenSinceMs >= RELOCK_AFTER_MS;
}
