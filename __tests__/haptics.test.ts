// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { hapticFor } from "@/components/layout/haptics";

/**
 * The shake gesture's only feedback (v2.18.1): one pulse when the amounts
 * hide, two when they come back - through the Vibration API where it works,
 * else iOS's switch haptic, which Safari plays when a native switch toggles.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("hapticFor", () => {
  it("vibrates once to hide and twice to show", () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate });
    hapticFor(true);
    hapticFor(false);
    expect(vibrate.mock.calls).toEqual([[[60]], [[40, 80, 40]]]);
  });

  // Safari has no navigator.vibrate; Chrome returns false before any tap.
  it("falls back to toggling a hidden native switch, once per pulse", () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { vibrate: () => false });
    const clicks: string[] = [];
    const original = HTMLLabelElement.prototype.click;
    HTMLLabelElement.prototype.click = function () {
      const input = this.querySelector("input");
      clicks.push(`${input?.type}:${input?.hasAttribute("switch")}`);
    };
    try {
      hapticFor(false);
      vi.advanceTimersByTime(500);
    } finally {
      HTMLLabelElement.prototype.click = original;
    }
    expect(clicks).toEqual(["checkbox:true", "checkbox:true"]);
    // Nothing is left behind in the document.
    expect(document.querySelectorAll("input[switch]")).toHaveLength(0);
  });
});
