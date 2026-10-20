"use client";

import { useEffect, useSyncExternalStore } from "react";
import { readDiscreet, setDiscreet } from "@/components/layout/discretion";
import {
  DISCRETION_SHAKE_COOKIE,
  createShakeDetector,
  shakeCookie,
  shakeListening,
  shakePreference,
  type ShakePreference,
} from "@/lib/domain/discretion";

// Shake to hide and show (v2.18): three quick shakes of the phone toggle
// discretion mode, the way Trade Republic does it - the same gesture hides
// and shows, with no dialog or toast on screen, only a short vibration where
// the phone has one.

const SHAKE_EVENT = "finalibaba:discretionshakechange";

type MotionWithPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

function motionApi(): MotionWithPermission | null {
  return typeof DeviceMotionEvent === "undefined" ? null : (DeviceMotionEvent as MotionWithPermission);
}

/** A phone or tablet: desktop browsers define DeviceMotionEvent too, with no sensor behind it. */
export function shakeSupported(): boolean {
  return motionApi() !== null && globalThis.matchMedia?.("(pointer: coarse)").matches === true;
}

/** iOS gates the motion sensor behind a prompt that must follow a tap. */
export function needsMotionPermission(): boolean {
  return typeof motionApi()?.requestPermission === "function";
}

/** Call from a click handler, before any await: iOS refuses it otherwise. */
export async function requestMotionPermission(): Promise<boolean> {
  const api = motionApi();
  if (!api?.requestPermission) return true;
  try {
    return (await api.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

function readPreference(): ShakePreference {
  const prefix = `${DISCRETION_SHAKE_COOKIE}=`;
  const entry = document.cookie.split("; ").find((part) => part.startsWith(prefix));
  return shakePreference(entry?.slice(prefix.length));
}

function subscribe(onChange: () => void) {
  globalThis.addEventListener(SHAKE_EVENT, onChange);
  return () => globalThis.removeEventListener(SHAKE_EVENT, onChange);
}

/** The device's choice; null during server rendering and hydration. */
export function useShakePreference(): ShakePreference | null {
  return useSyncExternalStore(subscribe, readPreference, () => null);
}

// Whether this page has received a real motion reading: the one sure sign
// the gesture works here (iOS sends none before its prompt is accepted).
let motionSeen = false;

/** True once the sensor has spoken on this page; false while rendering on the server. */
export function useMotionSeen(): boolean {
  return useSyncExternalStore(subscribe, () => motionSeen, () => false);
}

export function setShakePreference(on: boolean) {
  document.cookie = shakeCookie(on);
  globalThis.dispatchEvent(new Event(SHAKE_EVENT));
}

/** Listens for the gesture, mounted once in the root layout. */
export function DiscretionShake() {
  const preference = useShakePreference();

  useEffect(() => {
    if (preference === null || !shakeSupported()) return;
    if (!shakeListening(preference)) return;

    const isShake = createShakeDetector();
    function onMotion(event: DeviceMotionEvent) {
      const motion = event.accelerationIncludingGravity;
      if (!motionSeen && motion?.x != null) {
        motionSeen = true;
        globalThis.dispatchEvent(new Event(SHAKE_EVENT));
      }
      if (!motion || !isShake(motion, event.timeStamp)) return;
      setDiscreet(!readDiscreet());
      navigator.vibrate?.(40);
    }
    // Once turned on explicitly: the iOS grant may not outlive the app, so the
    // first tap asks again, which resolves without a prompt while it holds.
    function onFirstTap() {
      void requestMotionPermission();
    }

    globalThis.addEventListener("devicemotion", onMotion);
    if (preference === "on" && needsMotionPermission()) globalThis.addEventListener("pointerup", onFirstTap, { once: true });
    return () => {
      globalThis.removeEventListener("devicemotion", onMotion);
      globalThis.removeEventListener("pointerup", onFirstTap);
    };
  }, [preference]);

  return null;
}
