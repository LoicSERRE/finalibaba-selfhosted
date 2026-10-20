// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { BASE_CURRENCY_ATTRIBUTE, baseCurrency } from "@/lib/utils/base-currency";

/**
 * In the browser the base comes from <html data-base-currency>, rendered by
 * the root layout from the same value the server formats with - so a server
 * render and its hydration print the same unit (v2.19).
 */
describe("baseCurrency in the browser", () => {
  it("reads the attribute the root layout renders", () => {
    document.documentElement.setAttribute(BASE_CURRENCY_ATTRIBUTE, "GBP");
    expect(baseCurrency()).toBe("GBP");
  });
});
