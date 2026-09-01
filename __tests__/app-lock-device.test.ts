import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appLockDeviceKey,
  isAppLockDevice,
  markAppLockDevice,
  forgetAppLockDevice,
  shouldRelock,
  RELOCK_AFTER_MS,
} from "@/lib/domain/app-lock-device";

// The dead end this fixes, reported from a real instance: app-lock enabled on
// a laptop locked the phone too. The phone had no credential to unlock with,
// and Settings - where it would register one - sits behind that same lock.

function fakeStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    size: () => store.size,
  };
}

let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  storage = fakeStorage();
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isAppLockDevice", () => {
  it("is false on a browser that never registered, so it is never locked out", () => {
    expect(isAppLockDevice("user-a")).toBe(false);
  });

  it("is true once that browser registers", () => {
    markAppLockDevice("user-a");
    expect(isAppLockDevice("user-a")).toBe(true);
  });

  it("is per user, so one account's lock does not follow another on a shared browser", () => {
    markAppLockDevice("user-a");
    expect(isAppLockDevice("user-b")).toBe(false);
  });

  it("goes back to false after disabling", () => {
    markAppLockDevice("user-a");
    forgetAppLockDevice("user-a");
    expect(isAppLockDevice("user-a")).toBe(false);
  });
});

describe("when localStorage itself throws", () => {
  // A private window, cleared site data, or a browser set to block storage.
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
  });

  it("treats the device as unregistered rather than locking it", () => {
    // A browser that cannot remember registering cannot have registered, and
    // locking it would recreate the very dead end this exists to remove.
    expect(isAppLockDevice("user-a")).toBe(false);
  });

  it("never throws out of the writes, which run right after a real unlock", () => {
    expect(() => markAppLockDevice("user-a")).not.toThrow();
    expect(() => forgetAppLockDevice("user-a")).not.toThrow();
  });
});

describe("appLockDeviceKey", () => {
  it("namespaces by user", () => {
    expect(appLockDeviceKey("user-a")).not.toBe(appLockDeviceKey("user-b"));
    expect(appLockDeviceKey("user-a")).toContain("user-a");
  });

  it("does not collide with the unlock flag the gate keeps in sessionStorage", () => {
    // Both are per-user browser state for the same feature; distinct prefixes
    // keep "this device is locked at all" separate from "it is unlocked now".
    expect(appLockDeviceKey("user-a")).not.toBe(`finalibaba-applock-unlocked:user-a`);
  });
});

// The unlock used to last the whole browser session. An installed PWA is
// resumed far more often than it is cold-started, so in practice it almost
// never asked again - which makes the lock decorative.
describe("shouldRelock", () => {
  const NOW = 1_000_000;

  it("does not lock a session that was never backgrounded", () => {
    expect(shouldRelock(null, NOW)).toBe(false);
  });

  it("does not lock after a glance away", () => {
    // Switching apps to copy an IBAN and coming straight back must not
    // demand the biometric again.
    expect(shouldRelock(NOW - 30_000, NOW)).toBe(false);
  });

  it("locks once the threshold is reached", () => {
    expect(shouldRelock(NOW - RELOCK_AFTER_MS, NOW)).toBe(true);
  });

  it("locks well past it", () => {
    expect(shouldRelock(NOW - 60 * 60 * 1000, NOW)).toBe(true);
  });

  it("stays just under at one millisecond short", () => {
    expect(shouldRelock(NOW - RELOCK_AFTER_MS + 1, NOW)).toBe(false);
  });

  it("does not lock on a clock that jumped backwards", () => {
    // A negative elapsed time is not two minutes of absence.
    expect(shouldRelock(NOW + 60_000, NOW)).toBe(false);
  });
});
