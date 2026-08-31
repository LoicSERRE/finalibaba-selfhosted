import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appLockDeviceKey,
  isAppLockDevice,
  markAppLockDevice,
  forgetAppLockDevice,
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
